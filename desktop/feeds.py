"""Bounded RSS/Atom retrieval for the desktop reader; no credentials or scraping."""
import re
import urllib.error
import urllib.parse
import urllib.request

MAX_FEED_BYTES = 2 * 1024 * 1024

def feed_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        raise ValueError('Enter a valid HTTP or HTTPS feed URL.')
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        parsed.port
    except ValueError:
        raise ValueError('Enter an HTTP or HTTPS feed URL without embedded credentials.') from None
    return value

class FeedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        feed_url(newurl)
        if req.full_url.startswith('https:') and not newurl.startswith('https:'):
            raise ValueError('The feed redirected from HTTPS to an insecure address.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch_feed(url):
    url = feed_url(url)
    request = urllib.request.Request(url, headers={'Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9', 'User-Agent':'Open Sesame-Reader/0.1'})
    try:
        with urllib.request.build_opener(FeedRedirect()).open(request, timeout=10) as response:
            final = feed_url(response.geturl())
            data = response.read(MAX_FEED_BYTES + 1)
            if len(data) > MAX_FEED_BYTES:
                raise ValueError('This feed is larger than 2 MB.')
            encoding = response.headers.get_content_charset()
            if not encoding:
                declared = re.match(br'\s*<\?xml[^>]*encoding=["\']([^"\']+)', data[:200], re.I)
                encoding = declared.group(1).decode('ascii', 'replace') if declared else 'utf-8-sig'
            try:
                text = data.decode(encoding)
            except (LookupError, UnicodeError):
                text = data.decode('utf-8', 'replace')
            return {'url': final, 'text': text}
    except urllib.error.HTTPError as error:
        raise ValueError('The feed returned HTTP ' + str(error.code) + '.') from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('Could not reach this feed. Check its URL and your network connection.') from None
