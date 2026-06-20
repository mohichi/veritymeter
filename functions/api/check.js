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

分析の軸は2段階です。
1. 【主】記事の内容そのものの信憑性 ー 書かれている事実・主張・表現が、根拠を伴っているか、誇張や憶測がないか
2. 【補】掲載メディアの一般的な信頼性 ー どのような媒体か、という背景情報。あくまで参考情報であり、スコアの主要因ではない

JSON形式：
{
  "article_title": "記事のタイトル（取得できない場合は内容から推測した見出し）",
  "article_site": "掲載サイト名（例：Yahoo!ニュース、note、NHKニュース など）",
  "article_excerpt": "記事の内容を1文で要約（20〜40文字程度、どんな記事かひと目でわかるように）",

  "score": 数値(0-100、記事内容そのものの信憑性スコア),
  "verdict": "一言判定（10文字以内）",
  "summary": "2〜3文の概要評価（記事内容についての評価が中心）",

  "positives": [
    {"text": "記事内容として信頼できる点の説明"}
  ],
  "warnings": [
    {"text": "記事内容として注意すべき点の説明", "excerpt": "該当する記述の引用または箇所の説明（省略可）"}
  ],
  "verdict_full": "総評（3〜5文、記事内容の評価を中心に）",
  "tags": ["タグ1", "タグ2"],

  "media_background": {
    "source_type": "メディア種別（例：大手報道機関、個人ブログ、スピリチュアル系サイト など）",
    "media_note": "そのメディア・発信者の一般的な傾向や特徴について1〜2文（例：大手通信社で速報性と一次情報に強い、個人の見解中心のブログ形式 など）"
  }
}

スコア基準（記事内容そのものに対して）：
- 80-100：根拠が明確、一次情報や複数ソースで裏付けあり、誇張表現が少ない
- 60-79：概ね妥当だが一部に確認不足や程度の誇張がある
- 40-59：事実と憶測が混在、要確認の記述が目立つ
- 20-39：根拠が薄い、感情的・扇動的な表現が強い
- 0-19：事実関係に重大な問題、陰謀論的・誤情報的

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
        max_tokens: 2000,
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
