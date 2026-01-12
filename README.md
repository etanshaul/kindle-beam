# Kindle Beam

A Chrome extension that sends web articles to your Kindle with one click. Fully local - no external servers. Like Push to Kindle, but free. And like Amazon's Send to Kindle, but actually functional. 

## Requirements

- Arch Linux (or any Linux with Chrome)
- Google Chrome
- pandoc (`sudo pacman -S pandoc`)
- Python 3.6+
- Gmail account with 2FA enabled

## Setup

### 1. Install pandoc

```bash
sudo pacman -S pandoc
```

### 2. Create Gmail App Password

Gmail requires an App Password for SMTP (regular passwords won't work).

1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification if not already enabled
3. Go to https://myaccount.google.com/apppasswords
4. Select "Mail" and "Other (custom name)" → enter "Kindle Beam"
5. Click Generate - copy the 16-character password

### 3. Find Your Kindle Email

1. Go to https://www.amazon.com/hz/mycd/myx
2. Preferences → Personal Document Settings
3. Find your Kindle's email (e.g., `yourname_abc123@kindle.com`)

### 4. Add Gmail to Approved Senders

On the same Amazon page:
1. Scroll to "Approved Personal Document E-mail List"
2. Add your Gmail address

### 5. Run the Installer

```bash
./install.sh
```

The installer will:
- Check for pandoc
- Install the native messaging host
- Create a config template
- Prompt you for the Chrome extension ID

### 6. Edit Config

Edit `~/.config/kindle-beam/config.json`:

```json
{
  "smtp_user": "your-email@gmail.com",
  "smtp_pass": "xxxx xxxx xxxx xxxx",
  "kindle_email": "yourname@kindle.com"
}
```

## Usage

1. Navigate to any article
2. Click the Kindle Beam extension icon
3. Edit the title if needed
4. Click "Beam to Kindle"
5. Article arrives on your Kindle in 1-5 minutes

## Troubleshooting

### "Native host not installed"
Run `./install.sh` again. Make sure you entered the correct extension ID.

### "SMTP authentication failed"
- Make sure you're using an App Password, not your regular Gmail password
- The App Password should be 16 characters with no spaces

### "pandoc failed"
- Make sure pandoc is installed: `pandoc --version`
- The article may be malformed - try a different page

### Article not arriving on Kindle
- Check your Gmail sent folder - was the email sent?
- Verify your Kindle email is correct
- Make sure your Gmail is in Amazon's approved senders list
- Check your Kindle's wifi connection

## Files

```
~/.local/bin/kindle-beam-host           # Python backend
~/.config/google-chrome/NativeMessagingHosts/com.kindlebeam.json  # Native manifest
~/.config/kindle-beam/config.json       # Your credentials
```

## Uninstall

```bash
rm ~/.local/bin/kindle-beam-host
rm ~/.config/google-chrome/NativeMessagingHosts/com.kindlebeam.json
rm -rf ~/.config/kindle-beam
```

Then remove the extension from `chrome://extensions`.
