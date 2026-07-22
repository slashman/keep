<?php
// One-shot helper: create the /keep/data and /keep/img symlinks that let the Keep
// app read the live JSON + images under its own (bot-challenge-solved) /keep path.
// Upload to public_html/keep/, open in a browser once, confirm "ok", then DELETE it.

header('Content-Type: text/plain; charset=utf-8');

$links = [
    'data' => '../data',  // /keep/data -> public_html/data
    'img'  => '../img',   // /keep/img  -> public_html/img
];

$allOk = true;

foreach ($links as $name => $target) {
    $path = __DIR__ . '/' . $name;

    // Already a symlink? Leave it, just report where it points.
    if (is_link($path)) {
        echo "SKIP  $name  already a symlink -> " . readlink($path) . "\n";
    } elseif (file_exists($path)) {
        // A real file/dir is sitting there — do NOT clobber it.
        echo "ABORT $name  a real file/dir already exists here; not touching it\n";
        $allOk = false;
        continue;
    } elseif (@symlink($target, $path)) {
        echo "MADE  $name  -> $target\n";
    } else {
        $err = error_get_last();
        echo "FAIL  $name  symlink() failed" . (isset($err['message']) ? ": {$err['message']}" : "") . "\n";
        $allOk = false;
        continue;
    }

    // Verify the link actually resolves to a readable directory.
    $real = realpath($path);
    if ($real && is_dir($real) && is_readable($real)) {
        echo "      resolves to $real (readable)\n";
    } else {
        echo "      WARNING: does not resolve to a readable dir (target missing or blocked)\n";
        $allOk = false;
    }
}

echo "\n" . ($allOk ? "ALL OK — now DELETE this file (mklinks.php)." : "PROBLEMS above — fix, then re-run.") . "\n";
