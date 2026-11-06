"""Credential-free, bounded article and public repository retrieval for the native reader."""
import base64
import urllib.error
import urllib.request
from feeds import feed_url, FeedRedirect

MAX_BYTES = 2 * 1024 * 1024

def fetch_document(url):
    url = feed_url(url)
    request = urllib.request.Request(url, headers={'Accept': 'text/html, text/plain, application/rss+xml, application/atom+xml, application/xml, application/json;q=0.9, application/xhtml+xml;q=0.8', 'User-Agent': 'Open Sesame-Reader/0.1'})
    try:
        with urllib.request.build_opener(FeedRedirect()).open(request, timeout=10) as response:
            content_type = response.headers.get_content_type()
            if content_type not in ('text/html', 'text/plain', 'text/markdown', 'application/json', 'application/xhtml+xml', 'application/octet-stream', 'application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'):
                raise ValueError('This document opens in the PDF or website viewer.')
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError('This document exceeds 2 MB. Open the original instead.')
            try:
                text = data.decode(response.headers.get_content_charset() or 'utf-8-sig')
            except (UnicodeError, LookupError):
                text = data.decode('utf-8', 'replace')
            return {'text': text, 'url': feed_url(response.geturl()), 'type': content_type}
    except urllib.error.HTTPError as error:
        raise ValueError('Source returned HTTP ' + str(error.code) + '.') from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('Could not reach the source. Check the address and connection.') from None

def fetch_pdf(url):
    url = feed_url(url)
    limit = 24 * 1024 * 1024
    request = urllib.request.Request(url, headers={'Accept': 'application/pdf', 'User-Agent': 'Open Sesame-Reader/0.1'})
    try:
        with urllib.request.build_opener(FeedRedirect()).open(request, timeout=15) as response:
            if int(response.headers.get('Content-Length') or 0) > limit:
                raise ValueError('This paper exceeds the 24 MB PDF limit.')
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError('This paper exceeds the 24 MB PDF limit.')
            if b'%PDF-' not in data[:1024]:
                raise ValueError('This source did not return a PDF.')
            return {'data': base64.b64encode(data).decode('ascii')}
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('Could not fetch this PDF from its source.') from None
