// Cloudflare Pages Functions
// /api/deep-analysis
// 記事の心理学的・行動経済学的観点からの深層分析を行う

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const body = await request.json();
    const { url } = body;

    if (!url || !url.startsWith("http")) {
      return new Response(JSON.stringify({ error: "正しいURLを指定してください" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "APIキーが設定されていません" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }

    const systemPrompt = `あなたはメディアリテラシーと心理学・行動経済学の専門家AIです。
与えられたURLの記事を分析し、「なぜ人はこの記事を信じてしまうのか」という観点から深層分析を行ってください。
必ずJSONのみで返答すること。最初の文字は必ず「{」であること。前置きや説明、コードブロックマーカーは一切不要。

JSON形式：
{
  "psychological_biases": [
    {
      "name": "バイアス名（例：確証バイアス、感情的訴求、権威への訴えなど）",
      "description": "この記事でどう使われているかの説明（50文字以内）",
      "severity": "high/medium/low"
    }
  ],
  "fact_opinion_separation": {
    "facts": "事実として検証可能な記述の数と例（40文字以内）",
    "opinions": "意見・主張として含まれる記述の数と例（40文字以内）",
    "unverifiable": "検証困難な記述の数と例（40文字以内）"
  },
  "emotional_manipulation": {
    "detected": true/false,
    "techniques": ["使われている技法（例：恐怖訴求、怒りの喚起、緊急性の演出など）"],
    "examples": "具体的な表現例（60文字以内）"
  },
  "missing_perspectives": {
    "exists": true/false,
    "description": "欠けている視点や反対意見の説明（60文字以内）",
    "counterargument": "反対意見・別の見方の簡潔な提示（80文字以内）"
  },
  "author_intent": {
    "primary_goal": "執筆者の主な意図（例：情報提供、世論誘導、商品販売、特定思想の広めなど）（30文字以内）",
    "target_emotion": "読者に喚起しようとしている感情（例：不安、怒り、共感、優越感など）（20文字以内）",
    "call_to_action": "読者に取らせようとしている行動（例：シェア、購入、投票、信念の強化など）（30文字以内）"
  },
  "literacy_tips": [
    "この記事を読む際に意識すべきメディアリテラシーのポイント（40文字以内）"
  ]
}

URLにアクセスできない場合も、URLのドメインや構造から推測して分析してください。`;

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
        messages: [{ role: "user", content: `次のURLの記事を深層分析してください：${url}` }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return new Response(JSON.stringify({ error: "AI分析サービスでエラーが発生しました", detail: errText.slice(0, 300) }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }

    const data = await apiRes.json();
    const fullText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // {から始まるJSONを直接抽出
    const braceIdx = fullText.indexOf('{');
    let json;
    try {
      if (braceIdx >= 0) {
        let depth = 0;
        let endIdx = -1;
        for (let i = braceIdx; i < fullText.length; i++) {
          if (fullText[i] === '{') depth++;
          else if (fullText[i] === '}') {
            depth--;
            if (depth === 0) { endIdx = i; break; }
          }
        }
        json = JSON.parse(fullText.slice(braceIdx, endIdx + 1));
      } else {
        throw new Error("JSON not found");
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: "分析結果の解析に失敗しました" }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "サーバーエラーが発生しました", detail: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
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
