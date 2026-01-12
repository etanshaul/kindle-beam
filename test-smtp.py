#!/usr/bin/env python3
import smtplib
import json
import os

config_path = os.path.expanduser("~/.config/kindle-beam/config.json")
with open(config_path) as f:
    c = json.load(f)

print(f"Connecting as: {c['smtp_user']}")
try:
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(c["smtp_user"], c["smtp_pass"])
        print("SUCCESS - authentication works!")
except Exception as e:
    print(f"FAILED: {e}")
