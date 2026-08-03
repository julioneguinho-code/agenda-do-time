// Painel IA do gestor — usa a API da Anthropic quando ANTHROPIC_API_KEY existir.
// Sem chave, responde em modo demonstração.
const notion = require('./notion');

async function perguntar(session, { pergunta }) {
  const dados = await notion.painelGestor(session);
  if (!process.env.ANTHROPIC_API_KEY) {
    return { resposta: `— modo demonstração —\nPergunta: "${pergunta}"\nCom a chave da Anthropic configurada, eu analisaria os dados reais do time ${dados.time || ''} (check-ins, atividades, reuniões) e responderia aqui com recomendações práticas.` };
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: 'Você é o assistente de gestão da equipe de consultores Ademicon. Responda em português, curto e prático, focado em execução (fazer), nunca em valores financeiros. Baseie-se apenas nos dados fornecidos.',
      messages: [{ role: 'user', content: `Dados do time (JSON): ${JSON.stringify(dados)}\n\nPergunta do gestor: ${pergunta}` }],
    }),
  });
  const json = await res.json();
  return { resposta: json.content?.[0]?.text || 'Sem resposta.' };
}

module.exports = { perguntar };
