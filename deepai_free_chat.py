#!/usr/bin/env python3
"""
DeepAI Free Chat Client — DeepSeek V4.1 Flash (deepseek-1017 generation)
========================================================================
Model target : https://deepai.org/chat/deepseek-v4.1-flash  (0 Theos / free)
Endpoint     : POST https://api.deepai.org/hacking_is_a_serious_crime
               (multipart form, header "api-key: tryit-<rand>-<md5-chain>")
IMPORTANT    : api.deepai.org sits behind AWS WAF that fingerprints the TLS
               stack — plain requests/httpx/curl_cffi all get 403. The only
               reliable engine is a REAL browser. This script drives
               Playwright with the installed Google Chrome (channel="chrome").

Requirements :  pip install playwright  + Google Chrome installed
Login (once) :  python deepai_free_chat.py login   -> opens a browser window,
                you log in manually, session is saved to session.json.
                Anonymous sessions CAN send but DeepAI returns no AI reply
                without an account (verified: user bubble only, no response).

Usage        :  python deepai_free_chat.py chat "your prompt here"
                python deepai_free_chat.py chat --model glm-5.3-flash "..."
                python deepai_free_chat.py login
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://deepai.org"
CHAT_URL = BASE + "/chat/deepseek-v4.1-flash"
STATE_FILE = Path(__file__).parent / "session.json"

FREE_MODELS = [
    "deepseek-v4.1-flash",   # DeepSeek V4.1 Flash (default)
    "glm-5.3-flash",         # GLM 5.3 Flash
    "mimo-2.6-flash",        # MiMo 2.6 Flash
    "solar-mini-4",          # Solar Mini 4
    "gpt-6-luna",            # GPT-6 Luna
    "mimo-2.6-pro",          # MiMo 2.6 Pro
]


def launch(headless=True):
    p = sync_playwright().start()
    browser = p.chromium.launch(channel="chrome", headless=headless)
    ctx = browser.new_context(
        user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"),
        viewport={"width": 1280, "height": 800},
        storage_state=str(STATE_FILE) if STATE_FILE.exists() else None,
        locale="en-US",
    )
    return p, browser, ctx


def do_login():
    p, browser, ctx = launch(headless=False)
    page = ctx.new_page()
    page.goto(CHAT_URL, wait_until="domcontentloaded")
    print("[*] Log in di browser yang kebuka (email/Google).")
    print("[*] Setelah login sukses & chat terbuka, tutup browsernya / tekan Enter di sini.")
    input(">>> tekan Enter setelah login selesai: ")
    ctx.storage_state(path=str(STATE_FILE))
    print(f"[+] Session tersimpan: {STATE_FILE}")
    browser.close()
    p.stop()


def read_reply(page, timeout_s=120):
    """Wait for the AI output box inside #convo and return its text."""
    deadline = time.time() + timeout_s
    last_text = ""
    while time.time() < deadline:
        txt = page.evaluate(
            """() => {
              const c = document.getElementById('convo');
              if (!c) return '';
              // AI reply = every block AFTER the last user chatbox-wrapper
              const blocks = [...c.children];
              const lastUser = blocks.map(b => b.className).lastIndexOf('chatbox-wrapper');
              const outs = blocks.slice(lastUser + 1);
              return outs.map(b => b.innerText).join('\\n').trim();
            }"""
        )
        if txt and txt != last_text:
            last_text = txt
        # streaming done = stop button gone / submit visible again
        streaming = page.evaluate(
            """() => !!document.querySelector('[class*=is-streaming]')"""
        )
        if last_text and not streaming:
            time.sleep(1.5)  # let the tail arrive
            final = page.evaluate(
                """() => {
                  const c = document.getElementById('convo');
                  if (!c) return '';
                  const blocks = [...c.children];
                  const lastUser = blocks.map(b => b.className).lastIndexOf('chatbox-wrapper');
                  return blocks.slice(lastUser + 1).map(b => b.innerText).join('\\n').trim();
                }"""
            )
            return final or last_text
        time.sleep(1.0)
    return last_text


def do_chat(prompt, model="deepseek-v4.1-flash", headless=True):
    p, browser, ctx = launch(headless=headless)
    page = ctx.new_page()
    url = f"{BASE}/chat/{model}"
    page.goto(url, wait_until="domcontentloaded")
    time.sleep(3)

    # close possible popups
    page.evaluate("""() => document.querySelectorAll('[data-testid=close]').forEach(b => b.click())""")

    ta = page.locator("textarea[placeholder*='Message']").first
    if ta.count() == 0:
        print("[!] Composer tidak ketemu — coba jalankan 'login' dulu.")
        browser.close(); p.stop(); sys.exit(1)
    ta.click()
    ta.type(prompt, delay=15)
    page.keyboard.press("Enter")

    reply = read_reply(page)
    if not reply:
        print("[!] Kosong: kemungkinan belum login (python deepai_free_chat.py login) "
              "atau quota free habis.")
    else:
        print(reply)
    browser.close()
    p.stop()
    return reply


def main():
    ap = argparse.ArgumentParser(description="DeepAI free chat (DeepSeek V4.1 Flash)")
    ap.add_argument("command", choices=["login", "chat", "models"])
    ap.add_argument("prompt", nargs="*", help="prompt text for chat")
    ap.add_argument("--model", default="deepseek-v4.1-flash", help="model slug (see 'models')")
    ap.add_argument("--no-headless", action="store_true", help="show browser window")
    args = ap.parse_args()

    if args.command == "models":
        for m in FREE_MODELS:
            print(m)
    elif args.command == "login":
        do_login()
    elif args.command == "chat":
        if not args.prompt:
            print("usage: chat \"prompt\""); sys.exit(1)
        do_chat(" ".join(args.prompt), model=args.model, headless=not args.no_headless)


if __name__ == "__main__":
    main()
