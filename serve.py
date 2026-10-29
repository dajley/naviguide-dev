# Local test server: serves the app and passes the ESP32 camera stream through
# on the same address, so the browser doesn't block it.
# Run from the project folder: python serve.py
# Then open http://localhost:8001/?camera=esp32
import http.server
import socketserver
import urllib.request

PORT = 8001
ESP32_STREAM = "http://192.168.1.169:81/stream"


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/stream":
            self.relay_camera()
        else:
            super().do_GET()

    def relay_camera(self):
        try:
            upstream = urllib.request.urlopen(ESP32_STREAM, timeout=5)
        except Exception as err:
            self.send_error(502, f"Camera not reachable: {err}")
            return
        self.send_response(200)
        self.send_header("Content-Type", upstream.headers.get("Content-Type", "multipart/x-mixed-replace"))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while True:
                chunk = upstream.read1(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except Exception:
            pass  # The browser closed the stream, or the camera stopped sending.
        finally:
            upstream.close()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    with Server(("", PORT), Handler) as server:
        print(f"Open http://localhost:{PORT}/?camera=esp32")
        server.serve_forever()