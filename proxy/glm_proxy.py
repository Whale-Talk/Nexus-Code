#!/usr/bin/env python3
"""GLM Anthropic-to-OpenAI 本地代理
Claude Code (Anthropic) → 本代理 :9823 → GLM 官方 API
"""

import json
import re
import sys
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError

GLM_BASE = "https://open.bigmodel.cn/api/paas/v4"
API_KEY = "e5aa78d31f5a41729ba9736a5b89964f.hlWEaMYVG0yUJDCx"
PORT = 9823


def an_to_glm(an_req):
    """Anthropic request → GLM OpenAI-compatible request"""
    model = an_req.get("model", "glm-5.2")
    model = re.sub(r"\[.*?\]$", "", model)

    messages = []
    system = an_req.get("system")
    if isinstance(system, str) and system:
        messages.append({"role": "system", "content": system})
    elif isinstance(system, list):
        texts = [b["text"] for b in system if b.get("type") == "text"]
        if texts:
            messages.append({"role": "system", "content": "\n".join(texts)})

    for m in an_req.get("messages", []):
        role = m.get("role", "user")
        content = m.get("content")
        if isinstance(content, str):
            messages.append({"role": role, "content": content})
        elif isinstance(content, list):
            parts = []
            tool_calls = []
            for block in content:
                if block.get("type") == "text":
                    parts.append(block["text"])
                elif block.get("type") == "image":
                    parts.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{block['source']['media_type']};base64,{block['source']['data']}"
                        }
                    })
                elif block.get("type") == "tool_use":
                    tool_calls.append({
                        "id": block.get("id", str(uuid.uuid4())[:8]),
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": json.dumps(block.get("input", {}), ensure_ascii=False)
                        }
                    })
                elif block.get("type") == "tool_result":
                    messages.append({
                        "role": "tool",
                        "tool_call_id": block.get("tool_use_id", ""),
                        "content": block.get("content", "")
                    })
                    continue
            if tool_calls:
                messages.append({"role": "assistant", "tool_calls": tool_calls})
            elif parts:
                if all(isinstance(p, str) for p in parts):
                    messages.append({"role": role, "content": "\n".join(parts)})
                else:
                    messages.append({"role": role, "content": parts})

    glm_req = {
        "model": model,
        "messages": messages,
        "max_tokens": an_req.get("max_tokens", 4096),
        "stream": an_req.get("stream", False),
    }
    if an_req.get("temperature") is not None:
        glm_req["temperature"] = an_req["temperature"]
    if an_req.get("top_p") is not None:
        glm_req["top_p"] = an_req["top_p"]
    if an_req.get("stop_sequences"):
        glm_req["stop"] = an_req["stop_sequences"]
    if an_req.get("thinking"):
        glm_req["thinking"] = {"type": "enabled"}

    tools = an_req.get("tools")
    if tools:
        glm_req["tools"] = [{
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {}),
            }
        } for t in tools]

    return glm_req


def glm_to_an_sse(glm_chunk, an_model):
    """GLM SSE chunk → Anthropic SSE"""
    if not glm_chunk:
        return None
    try:
        data = json.loads(glm_chunk)
    except json.JSONDecodeError:
        return None

    choices = data.get("choices", [])
    if not choices:
        return None

    choice = choices[0]
    delta = choice.get("delta", {})
    finish = choice.get("finish_reason")

    an = {"type": "", "index": choice.get("index", 0)}

    if finish:
        an["type"] = "message_stop"
        an["amazon-bedrock-invocationMetrics"] = {
            "inputTokenCount": data.get("usage", {}).get("prompt_tokens", 0),
            "outputTokenCount": data.get("usage", {}).get("completion_tokens", 0),
        }
        return an

    if "content" in delta and delta["content"]:
        an["type"] = "content_block_delta"
        an["delta"] = {"type": "text_delta", "text": delta["content"]}
        return an

    if delta.get("tool_calls"):
        for tc in delta["tool_calls"]:
            func = tc.get("function", {})
            if "name" in func and func["name"]:
                an["type"] = "content_block_start"
                an["content_block"] = {
                    "type": "tool_use",
                    "id": tc.get("id", str(uuid.uuid4())[:8]),
                    "name": func["name"],
                    "input": {}
                }
                return an
            if "arguments" in func and func["arguments"]:
                an["type"] = "content_block_delta"
                an["delta"] = {"type": "input_json_delta", "partial_json": func["arguments"]}
                return an

    if delta.get("reasoning_content"):
        an["type"] = "content_block_delta"
        an["delta"] = {"type": "thinking_delta", "thinking": delta["reasoning_content"]}
        return an

    return None


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {args[0]}\n")

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if path not in ("/v1/messages", "/v1/messages", "/api/messages", "/api/messages"):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error":"not found"}')
            return

        body_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(body_len)
        an_req = json.loads(body)

        glm_req = an_to_glm(an_req)
        model_name = glm_req.get("model", "")
        is_stream = glm_req.get("stream", False)

        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] → {model_name} stream={is_stream} msgs={len(glm_req.get('messages',[]))}\n")

        api_url = f"{GLM_BASE}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        }
        req = Request(api_url, data=json.dumps(glm_req).encode(), headers=headers, method="POST")

        try:
            resp = urlopen(req, timeout=300)
        except HTTPError as e:
            sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] ✗ GLM error: {e.code} {e.read().decode()[:200]}\n")
            self.send_response(502)
            self.end_headers()
            self.wfile.write(b'{"error":"upstream error"}')
            return
        except Exception as e:
            sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] ✗ connection error: {e}\n")
            self.send_response(502)
            self.end_headers()
            self.wfile.write(b'{"error":"connection error"}')
            return

        if is_stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("x-request-id", str(uuid.uuid4()))
            self.end_headers()

            an_model = an_req.get("model", "")
            msg_started = False
            buf = b""
            for chunk in iter(lambda: resp.read(1), b""):
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.strip()
                    if not line or line == b"data: [DONE]":
                        continue
                    if line.startswith(b"data: "):
                        data_str = line[6:].decode("utf-8", errors="replace")
                        an_event = glm_to_an_sse(data_str, an_model)
                        if an_event:
                            if not msg_started:
                                self.wfile.write(b"event: message_start\ndata: {}\n\n".format(
                                    json.dumps({"message": {"model": an_model}}).encode()))
                                msg_started = True
                            self.wfile.write(b"event: content_block_start\ndata: " + json.dumps(an_event).encode() + b"\n\n")
            self.wfile.write(b"event: message_stop\ndata: {}\n\n")
        else:
            raw = resp.read()
            glm_resp = json.loads(raw)
            choices = glm_resp.get("choices", [])
            usage = glm_resp.get("usage", {})

            content_blocks = []
            for c in choices:
                msg = c.get("message", {})
                reasoning = msg.get("reasoning_content", "")
                text = msg.get("content", "")
                if reasoning:
                    content_blocks.append({"type": "thinking", "thinking": reasoning})
                if text:
                    content_blocks.append({"type": "text", "text": text})
                if msg.get("tool_calls"):
                    for tc in msg["tool_calls"]:
                        content_blocks.append({
                            "type": "tool_use",
                            "id": tc.get("id", str(uuid.uuid4())[:8]),
                            "name": tc["function"]["name"],
                            "input": json.loads(tc["function"].get("arguments", "{}"))
                        })

            if not content_blocks:
                content_blocks = [{"type": "text", "text": ""}]

            an_resp = {
                "id": glm_resp.get("id", str(uuid.uuid4())),
                "type": "message",
                "role": "assistant",
                "model": an_req.get("model", ""),
                "content": content_blocks,
                "stop_reason": choices[0].get("finish_reason", "end_turn") if choices else "end_turn",
                "usage": {
                    "input_tokens": usage.get("prompt_tokens", 0),
                    "output_tokens": usage.get("completion_tokens", 0),
                },
            }

            body = json.dumps(an_resp, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] ← done\n")


if __name__ == "__main__":
    print(f"GLM Proxy → {GLM_BASE}")
    print(f"Listening on :{PORT}")
    server = HTTPServer(("127.0.0.1", PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
