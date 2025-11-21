export default async function handler(req, res) {
    // Request method check
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { url } = req.body;

        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Invalid URL' });
        }

        // 1. Fetch Raw HTML
        const htmlRes = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const htmlText = await htmlRes.text();
        const htmlSize = Buffer.byteLength(htmlText, 'utf8');

        // 2. Fetch Firecrawl
        const apiKey = process.env.FIRECRAWL_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Missing API Key' });
        }

        const firecrawlRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                url: url,
                formats: ["markdown"],
                onlyMainContent: true,
                includeTags: ["article", "main", "h1", "p", "ul", "ol"]
            })
        });

        const firecrawlData = await firecrawlRes.json();
        const markdown = firecrawlData.data?.markdown || "# Error\nCould not retrieve content.";
        const mdSize = Buffer.byteLength(markdown, 'utf8');

        // 3. Generate Previews
        const claudePreview = JSON.stringify({
            source: "Spring AI",
            meta: { url, date: new Date().toISOString() },
            content: markdown.substring(0, 500) + "..."
        }, null, 2);

        const schema = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            "url": url,
            "articleBody": markdown.substring(0, 200) + "..."
        }, null, 2);
        
        const geminiPreview = `<!DOCTYPE html><html><head><script type="application/ld+json">${schema}</script></head><body><div class="markdown-body">${markdown.substring(0, 500).replace(/</g, "&lt;")}...</div></body></html>`;

        // 4. Return Results
        return res.status(200).json({
            success: true,
            metrics: {
                html_size: (htmlSize / 1024).toFixed(2),
                md_size: (mdSize / 1024).toFixed(2),
                reduction: (((htmlSize - mdSize) / htmlSize) * 100).toFixed(1),
                cost_before: ((htmlSize / 4 / 1000) * 0.0025 * 1000).toFixed(2),
                cost_after: ((mdSize / 4 / 1000) * 0.0025 * 1000).toFixed(2)
            },
            previews: {
                gpt: markdown,
                claude: claudePreview,
                gemini: geminiPreview
            }
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
