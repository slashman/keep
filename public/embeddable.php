<?php
// embeddable.php — reports whether a URL may be shown inside the Keep's in-app
// popup <iframe>.
//
// Why this can't be done in the browser: a cross-origin frame that is refused by
// X-Frame-Options or CSP `frame-ancestors` still fires its `load` event (the
// browser paints its own "refused to connect" page), and same-origin rules forbid
// reading the frame's contents — so JS has no signal to tell "loaded" from
// "blocked". We fetch the target's response headers here and inspect them instead.
//
// Response: {"embeddable": true|false, "reason": "..."}. On any ambiguity (network
// error, target down) we answer `true` so the client still attempts the frame and
// the always-present "Open in new tab" link stays the safety net — we only report
// `false` when a header positively forbids framing.
//
// Deployed at /keep/embeddable.php — Vite copies public/ to the build root, which
// ships to public_html/keep/. In dev, Vite can't execute PHP, so the client routes
// here via the /keep-api proxy (see vite.config.ts) against the deployed copy; if
// it isn't deployed yet the client's fetch fails and it falls back to `true`.

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=86400'); // a site's framing policy rarely changes

function out($embeddable, $reason = 'ok') {
    echo json_encode(['embeddable' => (bool) $embeddable, 'reason' => $reason]);
    exit;
}

$url = isset($_GET['url']) ? trim($_GET['url']) : '';
if ($url === '') out(true, 'no-url');

// Accept only real http(s) URLs with a host — refuse file://, localhost, and raw
// private/loopback IPs so this can't be turned into an internal-network probe.
$parts = parse_url($url);
if (!$parts || empty($parts['scheme']) || empty($parts['host'])) out(true, 'bad-url');
$scheme = strtolower($parts['scheme']);
if ($scheme !== 'http' && $scheme !== 'https') out(true, 'bad-scheme');
$host = strtolower($parts['host']);
if ($host === 'localhost') out(true, 'blocked-host');
if (filter_var($host, FILTER_VALIDATE_IP)
    && !filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
    out(true, 'blocked-host');
}

/**
 * Fetch the final response's headers (following redirects) as a lowercased map.
 * Values for a repeated header are joined with ", ". Returns [$headers, $code] or
 * [null, 0] on transport error. Tries HEAD first, falls back to GET on 405.
 */
function fetch_headers($url, $method) {
    $headers = [];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_NOBODY         => $method === 'HEAD',
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; SlashieKeep/1.0; +https://slashie.net/keep)',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
            // Each redirect hop begins with a new "HTTP/.." status line — reset so we
            // keep only the final response's headers.
            if (preg_match('#^HTTP/#i', $line)) {
                $headers = [];
            } else {
                $p = strpos($line, ':');
                if ($p !== false) {
                    $k = strtolower(trim(substr($line, 0, $p)));
                    $v = trim(substr($line, $p + 1));
                    $headers[$k] = isset($headers[$k]) ? $headers[$k] . ', ' . $v : $v;
                }
            }
            return strlen($line);
        },
        // On a GET, abort as soon as the body starts — we only need headers.
        CURLOPT_WRITEFUNCTION  => function ($ch, $data) { return 0; },
    ]);
    curl_exec($ch);
    $errno = curl_errno($ch);
    $code  = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    // CURLE_WRITE_ERROR (23) is expected — it's our WRITEFUNCTION aborting the body.
    if ($errno && $errno !== 23) return [null, 0];
    return [$headers, $code];
}

if (!function_exists('curl_init')) out(true, 'no-curl');

list($headers, $code) = fetch_headers($url, 'HEAD');
if ($headers === null || $code === 405 || $code === 403) {
    // Some servers reject HEAD — retry with GET (body aborted immediately).
    list($headers, $code) = fetch_headers($url, 'GET');
}
if ($headers === null) out(true, 'fetch-failed');

$xfo = isset($headers['x-frame-options']) ? strtolower($headers['x-frame-options']) : '';
$csp = isset($headers['content-security-policy']) ? strtolower($headers['content-security-policy']) : '';

// X-Frame-Options: DENY blocks everyone; SAMEORIGIN blocks us (we're a different
// origin than the target). ALLOW-FROM is obsolete and ignored by modern browsers.
if (strpos($xfo, 'deny') !== false || strpos($xfo, 'sameorigin') !== false) {
    out(false, 'x-frame-options');
}

// CSP frame-ancestors takes precedence over XFO where present. 'none' blocks all;
// any restrictive list blocks us unless it explicitly allows '*' or slashie.net.
if (preg_match('/frame-ancestors([^;]*)/', $csp, $m)) {
    $fa = trim($m[1]);
    if (strpos($fa, "'none'") !== false) {
        out(false, 'frame-ancestors-none');
    }
    if (strpos($fa, '*') === false && strpos($fa, 'slashie.net') === false) {
        out(false, 'frame-ancestors');
    }
}

out(true, 'ok');
