// Cloudflare Pages Functions
// このファイルはサーバー側で実行されるため、APIキーがブラウザに漏れることはありません。
// APIキーは Cloudflare ダッシュボード > Settings > Environment variables に設定してください（変数名: ANTHROPIC_API_KEY）

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS対応（同一サイトからのみ呼ばれる想定だが念のため）
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

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

    const systemPrompt = `記事信憑性診断AIです。URLから記事を分析しJSONのみ返答。最初の文字は必ず「{」。

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
        messages: [{ role: "user", content: `診断：${url}` }],
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

    // テキストブロックをすべて連結する（web検索ツール使用時は複数ブロックに分かれることがある）
    const fullText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const clean = fullText.replace(/```json|```/g, "").trim();

    let json;
    try {
      // 最後に出現するJSONオブジェクト（最も完成度の高い最終回答である可能性が高い）を優先的に探す
      const matches = clean.match(/\{[\s\S]*\}/g);
      const candidate = matches && matches.length ? matches[matches.length - 1] : clean;
      json = JSON.parse(candidate);
    } catch (e) {
      // 解析に失敗した場合、原因調査のためAIの実際の返答内容を一緒に返す
      return new Response(
        JSON.stringify({
          error: "分析結果の解析に失敗しました",
          raw_response: fullText.slice(0, 2000),
          stop_reason: data.stop_reason || null,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
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
