"""Lokale frontend-test zonder workerd: serveert public/ en /api/data uit data/snapshot.json."""
import os, json, subprocess, urllib.request, urllib.error, http.server, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshot.json")


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/data":
            body = open(SNAP, "rb").read()
            self.send_response(200)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/api/changes":
            f = os.path.join(ROOT, "data", "changes.json")
            body = open(f, "rb").read() if os.path.exists(f) else b"[]"
            self.send_response(200)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        # Lokaal alleen 'preview' doorzetten naar n8n (nooit execute); sleutel uit %USERPROFILE%\smt_action_key.txt
        if self.path != "/api/action":
            return self.send_error(404)
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        if body.get("mode") != "preview":
            out, status = json.dumps({"error": "Lokaal alleen preview"}).encode(), 403
        else:
            body["user"] = "local-test@localhost"
            req = urllib.request.Request(N8N_ACTION_URL, data=json.dumps(body).encode(), method="POST",
                                         headers={"content-type": "application/json", "X-SMT-Action-Key": action_key()})
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    out, status = r.read(), r.status
            except urllib.error.HTTPError as e:
                out, status = e.read(), e.code
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


N8N_ACTION_URL = "https://n8n-basicfit-e4041d8cfe5c.herokuapp.com/webhook/supplier-management-tool/action"
_key = None


def action_key():
    global _key
    if _key is None:
        ps = ('$ss=Get-Content "$env:USERPROFILE\\smt_action_key.txt"|ConvertTo-SecureString;'
              '(New-Object System.Management.Automation.PSCredential("x",$ss)).GetNetworkCredential().Password')
        _key = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout.strip()
    return _key


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), functools.partial(Handler, directory=os.path.join(ROOT, "public")))
    print("http://127.0.0.1:8799  (Ctrl+C om te stoppen)")
    srv.serve_forever()
