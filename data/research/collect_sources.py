"""Collect public research evidence; never execute content from fetched sources."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
RAW = ROOT / 'raw'
RAW.mkdir(parents=True, exist_ok=True)
HEADERS = {'User-Agent': 'RestaurantProductResearch/1.0', 'Accept': 'application/json,text/html,text/plain,*/*'}


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ignore = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript', 'svg'):
            self.ignore += 1
        elif tag in ('p', 'br', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'tr', 'article', 'section'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'svg') and self.ignore:
            self.ignore -= 1

    def handle_data(self, value):
        if not self.ignore:
            self.parts.append(value)


def fetch_record(identifier, url, category, title=''):
    file = RAW / (identifier + '.json')
    if file.exists():
        cached = json.loads(file.read_text(encoding='utf-8'))
        if cached.get('status') == 200:
            return cached
    record = {'id': identifier, 'url': url, 'category': category, 'title': title,
              'retrieved_at': datetime.now(timezone.utc).isoformat()}
    try:
        request = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(request, timeout=35) as response:
            raw = response.read(4_000_000)
            decoded = raw.decode('utf-8', errors='replace')
            record.update(status=response.status, final_url=response.url,
                          content_type=response.headers.get('Content-Type'),
                          sha256=hashlib.sha256(raw).hexdigest())
        if '<html' in decoded[:2000].lower() or '<!doctype html' in decoded[:2000].lower():
            parser = PageText()
            parser.feed(decoded)
            record['text'] = re.sub(r'\n\s*\n+', '\n\n', ''.join(parser.parts)).strip()
            page_title = re.search(r'<title[^>]*>(.*?)</title>', decoded, re.S | re.I)
            record['page_title'] = re.sub('<[^>]+>', '', page_title.group(1)) if page_title else ''
        else:
            record['text'] = decoded
            if 'api.github.com' in url:
                record['json'] = json.loads(decoded)
    except Exception as exc:
        record.update(status=getattr(exc, 'code', 0), error=str(exc))
    file.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return record


def run_batch(entries):
    results = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fetch_record, **entry): entry for entry in entries}
        for future in as_completed(futures):
            record = future.result()
            results.append(record)
            print(json.dumps({key: record.get(key) for key in ('id', 'status', 'title', 'error')}, ensure_ascii=False), flush=True)
    return results


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('batch')
    args = parser.parse_args()
    entries = json.loads((ROOT / args.batch).read_text(encoding='utf-8'))
    results = run_batch(entries)
    manifest = []
    for file in sorted(RAW.glob('*.json')):
        record = json.loads(file.read_text(encoding='utf-8'))
        manifest.append({key: record.get(key) for key in ('id', 'title', 'url', 'category', 'status', 'retrieved_at', 'sha256', 'error')})
    (ROOT / 'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'batch_count': len(results), 'total_sources': len(manifest), 'success': sum(r.get('status') == 200 for r in results)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
