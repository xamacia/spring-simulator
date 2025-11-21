<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Allow fetch from frontend

// === CONFIGURATION ===
// 🔴 PASTE YOUR FIRECRAWL API KEY HERE 🔴
define('FIRECRAWL_API_KEY', 'fc-d6a56198ba4e4539bdeb2cade7c11e41'); 
// =====================

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Only POST allowed']);
    exit;
}

// Get JSON input
$input = json_decode(file_get_contents('php://input'), true);
$url = $input['url'] ?? '';

if (!filter_var($url, FILTER_VALIDATE_URL)) {
    echo json_encode(['error' => 'Invalid URL provided']);
    exit;
}

// 1. Fetch Raw HTML (The "Before")
$start = microtime(true);
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_USERAGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
$html = curl_exec($ch);
$html_size = strlen($html);
$html_time = round(microtime(true) - $start, 3);
curl_close($ch);

if (!$html) {
    echo json_encode(['error' => 'Could not fetch target URL']);
    exit;
}

// 2. Fetch Optimized Markdown (The "After" - via Firecrawl)
$start_api = microtime(true);
$ch_api = curl_init("https://api.firecrawl.dev/v1/scrape");
$payload = json_encode([
    "url" => $url,
    "formats" => ["markdown"],
    "onlyMainContent" => true,
    "includeTags" => ["article", "main", "h1", "p", "ul", "ol"]
]);

curl_setopt($ch_api, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch_api, CURLOPT_POST, true);
curl_setopt($ch_api, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch_api, CURLOPT_HTTPHEADER, [
    "Content-Type: application/json",
    "Authorization: Bearer " . FIRECRAWL_API_KEY
]);

$response = curl_exec($ch_api);
$api_data = json_decode($response, true);
curl_close($ch_api);

if (!isset($api_data['data']['markdown'])) {
    // Fallback for demo if API fails or quota exceeded
    $markdown = "# Analysis Failed\n\nCould not reach Firecrawl API. Please check API Key.";
} else {
    $markdown = $api_data['data']['markdown'];
}

$markdown_size = strlen($markdown);

// 3. Generate "Bot Specific" Previews (Replicating Plugin Logic)

// A. Claude Format (JSON)
$claude_preview = json_encode([
    'source' => 'Spring AI',
    'meta' => [
        'url' => $url,
        'generated' => date('c'),
        'tokens_saved' => round(($html_size - $markdown_size) / 4)
    ],
    'content' => substr($markdown, 0, 500) . "... (truncated for preview)"
], JSON_PRETTY_PRINT);

// B. Gemini Format (HTML + Schema)
$schema = json_encode([
    '@context' => 'https://schema.org',
    '@type' => 'Article',
    'url' => $url,
    'articleBody' => substr($markdown, 0, 200) . "..."
], JSON_PRETTY_PRINT);

$gemini_preview = "<!DOCTYPE html>
<html>
<head>
  <script type=\"application/ld+json\">
{$schema}
  </script>
</head>
<body>
  <div class=\"markdown-body\">
    " . htmlspecialchars(substr($markdown, 0, 500)) . "...
  </div>
</body>
</html>";

// C. Calculations
$reduction = round((($html_size - $markdown_size) / $html_size) * 100, 1);
$cost_before = ($html_size / 4 / 1000) * 0.0025 * 1000; // Cost per 1k visits
$cost_after = ($markdown_size / 4 / 1000) * 0.0025 * 1000;

// Return Payload
echo json_encode([
    'success' => true,
    'metrics' => [
        'html_size' => round($html_size / 1024, 2),
        'md_size' => round($markdown_size / 1024, 2),
        'reduction' => $reduction,
        'cost_before' => number_format($cost_before, 2),
        'cost_after' => number_format($cost_after, 2)
    ],
    'previews' => [
        'gpt' => $markdown,
        'claude' => $claude_preview,
        'gemini' => $gemini_preview
    ]
]);
?>