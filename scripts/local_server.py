"""Lokale frontend-test zonder workerd: serveert public/ en /api/data uit data/snapshot.json."""
import os, http.server, functools

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
        return super().do_GET()


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), functools.partial(Handler, directory=os.path.join(ROOT, "public")))
    print("http://127.0.0.1:8799  (Ctrl+C om te stoppen)")
    srv.serve_forever()
