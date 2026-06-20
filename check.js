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

    const systemPrompt = `あなたは記事の信憑性を診断する専門AIです。
与えられたURLの記事について以下を分析し、必ずJSONのみで返答してください（前置き・説明・マークダウン不要）。

JSON形式：
{
  "score": 数値(0-100),
  "verdict": "一言判定（10文字以内）",
  "summary": "2〜3文の概要評価",
  "source_type": "メディア種別（例：大手報道機関、個人ブログ、スピリチュアル系サイト など）",
  "positives": [
    {"text": "信頼できる点の説明"}
  ],
  "warnings": [
    {"text": "注意すべき点の説明", "excerpt": "該当する記述の引用または箇所の説明（省略可）"}
  ],
  "verdict_full": "総評（3〜5文）",
  "tags": ["タグ1", "タグ2"]
}

スコア基準：
- 80-100：大手報道機関、一次情報、複数ソース確認済み
- 60-79：概ね信頼できるが一部確認不足
- 40-59：事実と憶測が混在、要確認
- 20-39：根拠が薄い、感情的訴求が強い
- 0-19：フェイクニュース的、陰謀論的

URLにアクセスできない場合も、URLのドメインや構造から推測して診断してください。`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: `次のURLの記事を信憑性診断してください：${url}` }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
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
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const clean = fullText.replace(/```json|```/g, "").trim();

    let json;
    try {
      const match = clean.match(/\{[\s\S]*\}/);
      json = JSON.parse(match ? match[0] : clean);
    } catch (e) {
      return new Response(JSON.stringify({ error: "分析結果の解析に失敗しました" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
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
