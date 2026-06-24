// Cloudflare Pages Functions
// /api/timeline
// 指定されたテーマについてAIがウェブ検索し、状況と前回からの変化を返す
// period が指定された場合は、その期間（例：2025年2月、2023年）の過去調査を行う

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const body = await request.json();
    const { themeId, themeName, keywords, previousData, period } = body;
    // period: { label: "2025年2月", year: 2025, month: 2 } のような形式
    // period が null/undefined の場合は「今日の最新情報」を取得

    if (!themeId || !themeName || !keywords) {
      return new Response(JSON.stringify({ error: "必要なパラメータが不足しています" }), {
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

    const today = new Date().toISOString().slice(0, 10);
    const targetPeriod = period ? period.label : today;
    const isPast = !!period;

    const lastEntry = previousData && previousData.length > 0
      ? previousData[previousData.length - 1]
      : null;

    const systemPrompt = `あなたはニュース調査・信憑性診断の専門AIです。
指定されたテーマについてウェブ検索し、指定期間の状況を調査してください。
公式統計・白書・政府発表・主要報道機関の記事を優先的に参照してください。
必ずJSONのみで返答すること。最初の文字は必ず「{」であること。前置きや説明、コードブロックマーカーは一切不要。

JSON形式：
{
  "headline": "その期間の最も重要な動向の見出し（40文字以内）",
  "url": "最も信頼性の高い参考記事・資料のURL",
  "source": "情報源のメディア名・機関名",
  "summary": "その期間の状況の要約（80文字以内）",
  "diff": "前の期間から変化した点（40文字以内）。前回データがない場合は空文字"
}`;

    const userPrompt = `テーマ：${themeName}
検索キーワード：${keywords}
調査対象期間：${targetPeriod}
${isPast ? '※これは過去の期間の調査です。その期間に実際に起きたことを調査してください。公式統計・白書・政府発表も参照してください。' : ''}

${lastEntry ? `前の期間の状況（${lastEntry.date}）：${lastEntry.summary}` : '（初回調査）'}

この期間の状況をJSONで返してください。`;

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
        messages: [{ role: "user", content: userPrompt }],
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

    const entry = {
      date: targetPeriod,
      isPast: isPast,
      headline: json.headline || "",
      url: json.url || "#",
      source: json.source || "AI調査",
      summary: json.summary || "",
      diff: json.diff || "",
    };

    return new Response(JSON.stringify({ entry }), {
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
