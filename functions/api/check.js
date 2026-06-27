// Cloudflare Pages Functions - check.js
// ①CloudflareのfetchでURLの本文を取得・抽出
// ②抽出したテキストをClaudeに渡して分析（web_searchなし）
// APIキーは Environment variables の ANTHROPIC_API_KEY に設定

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// HTMLから本文テキストを抽出する関数
function extractText(html, url) {
  // タイトルを抽出
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  // OGタイトル・ディスクリプションを抽出（より正確なタイトル・概要）
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);

  const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : '';
  const ogDesc = ogDescMatch ? ogDescMatch[1].trim() : '';

  // scriptタグ・styleタグ・ナビゲーション等を除去
  let body = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  // 本文を最大3000文字に制限（トークン節約）
  const bodyText = body.slice(0, 3000);

  return { title: ogTitle || title, ogDesc, bodyText };
}

// URLから本文を取得する関数
async function fetchArticle(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VerityMeter/1.0; +https://veritymeter.org)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

    const html = await res.text();
    return extractText(html, url);
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const url = (body.url || "").trim();

    if (!url || !url.startsWith("http")) {
      return new Response(JSON.stringify({ error: "正しいURLを指定してください" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "サーバー側のAPIキーが設定されていません" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ①本文を取得
    const article = await fetchArticle(url);

    // ②Claudeへ渡すコンテンツを構築
    // 本文が取得できた場合はテキストを渡す、取得できなかった場合はURLのみ
    let userContent;
    if (article && (article.bodyText || article.ogDesc)) {
      userContent = `URL: ${url}
タイトル: ${article.title || '不明'}
概要: ${article.ogDesc || ''}
本文（抜粋）:
${article.bodyText}`;
    } else {
      userContent = `URL: ${url}
※本文の取得ができませんでした。URLのドメインや構造から推測して診断してください。`;
    }

    const systemPrompt = `記事信憑性診断AIです。提供された記事テキストを分析しJSONのみ返答。最初の文字は必ず「{」。

JSON形式：
{"article_title":"タイトル","article_site":"サイト名","article_excerpt":"1文要約(30字)","score":数値(0-100),"verdict":"判定(10字以内)","summary":"評価2文","positives":[{"text":"信頼できる点"}],"warnings":[{"text":"注意点","excerpt":"該当箇所"}],"verdict_full":"総評2文","tags":["タグ"],"media_background":{"source_type":"メディア種別","media_note":"特徴1文"}}

スコア：80-100=根拠明確、60-79=概ね妥当、40-59=事実と憶測混在、20-39=根拠薄い、0-19=重大な問題`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return new Response(JSON.stringify({ error: "AI分析サービスでエラーが発生しました", detail: errText }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const data = await apiRes.json();
    const fullText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const clean = fullText.replace(/```json|```/g, "").trim();

    let json;
    try {
      const matches = clean.match(/\{[\s\S]*\}/g);
      const candidate = matches && matches.length ? matches[matches.length - 1] : clean;
      json = JSON.parse(candidate);
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "分析結果の解析に失敗しました",
          raw_response: fullText.slice(0, 2000),
        }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "サーバーエラーが発生しました", detail: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
