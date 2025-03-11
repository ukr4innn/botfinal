import dotenv from 'dotenv';
import { Telegraf, Markup, session } from 'telegraf';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Remover listeners de advertência
process.removeAllListeners('warning');

// Inicializar Express
const app = express();
app.use(cors());
app.use(express.json());

// Inicializar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Erro: Variáveis do Supabase não configuradas no .env!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Usar middleware de sessão
bot.use(session());

// Constantes e Variáveis Globais
const ADMIN_ID = 7584998414;
const GRUPO_ID = -1002414086906;

let saldoDuplicadoAtivo = false;
let promocaoAtiva = null;

// Preços por nível de cartão
const precosPorNivel = {
  'CLASSIC': 10,
  'BLACK': 20,
  'PLATINUM': 30,
  'BUSINESS': 55,
  'GOLD': 40,
  'INFINITE': 80
};

// Preços por loja (para logins)
const precosPorLoja = {
  'Netflix': 20,
  'Spotify': 20,
  'Disney+': 25,
  'Amazon Prime': 22,
  'HBO Max': 28
};
// Funções Auxiliares
const isAdmin = (userId) => userId === ADMIN_ID;

const formatarMoeda = (valor) => `R$ ${valor.toFixed(2)}`;

const gerarCodigoAleatorio = () => Math.random().toString(36).substring(2, 10).toUpperCase();

const enviarMensagemEstilizada = async (ctx, mensagem, teclado = null) => {
  const opcoesEnvio = { parse_mode: 'Markdown' };
  if (teclado) {
    opcoesEnvio.reply_markup = { inline_keyboard: teclado };
  }
  try {
    await ctx.reply(mensagem, opcoesEnvio);
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
  }
};

bot.action(/solicitar_troca_login_(\d+)/, async (ctx) => {
  const loginId = ctx.match[1];
  try {
    await ctx.answerCbQuery();

    const usuario = await buscarUsuario(ctx.from.id);
    if (!usuario) {
      await ctx.editMessageText("❌ Erro ao acessar seu perfil. Por favor, tente novamente ou contate o suporte.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]]
        }
      });
      return;
    }

    const { data: login, error } = await supabase
      .from('logins')
      .select('*')
      .eq('id', loginId)
      .single();

    if (error || !login) {
      await ctx.editMessageText("❌ Erro: Login não encontrado.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]]
        }
      });
      return;
    }

    if (login.comprador_id !== usuario.telegram_id) {
      await ctx.editMessageText("❌ Você não tem permissão para solicitar troca deste login.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]]
        }
      });
      return;
    }

    const mensagemAdmin = `
🔄 *Solicitação de Troca de Login*

👤 Usuário: ${ctx.from.first_name} (ID: ${ctx.from.id})
🔐 Login: ${login.email}
🏢 Loja: ${login.loja}
🎭 Plano: ${login.plano || 'N/A'}

Por favor, verifique e processe esta solicitação de troca.
    `;

    try {
      await bot.telegram.sendMessage(ADMIN_ID, mensagemAdmin, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("✅ Aceitar Troca", `aceitar_troca_login_${loginId}_${ctx.from.id}`)]
          ]
        }
      });

      await ctx.editMessageText(`
✅ Sua solicitação de troca de login foi enviada ao suporte.

Por favor, aguarde o processamento. Entraremos em contato em breve.
      `, {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("🏠 Voltar ao Menu Principal", "voltar_menu")]
          ]
        }
      });
    } catch (error) {
      console.error("Erro ao enviar mensagem para o admin:", error);
      await ctx.editMessageText("❌ Erro ao processar solicitação. Tente novamente mais tarde.", {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("🔄 Tentar Novamente", `solicitar_troca_login_${loginId}`)],
            [Markup.button.callback("🏠 Voltar ao Menu Principal", "voltar_menu")]
          ]
        }
      });
    }

  } catch (error) {
    console.error("Erro ao solicitar troca de login:", error);
    await ctx.editMessageText("❌ Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente ou contate o suporte.", {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("🔄 Tentar Novamente", `solicitar_troca_login_${loginId}`)],
          [Markup.button.callback("☎️ Contatar Suporte", "suporte")],
          [Markup.button.callback("🏠 Voltar ao Menu Principal", "voltar_menu")]
        ]
      }
    });
  }
});
// Função para aceitar a troca de login (apenas para o admin)
bot.action(/aceitar_troca_login_(\d+)_(\d+)/, async (ctx) => {
  // Verificar se quem está respondendo é o admin
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery("Apenas o administrador pode aceitar trocas.");
    return;
  }

  const loginId = ctx.match[1];
  const userId = ctx.match[2];

  try {
    await ctx.answerCbQuery();

    const { data: login, error: loginError } = await supabase
      .from('logins')
      .select('*')
      .eq('id', loginId)
      .single();

    if (loginError || !login) {
      await ctx.editMessageText("❌ Erro: Login não encontrado ou já foi trocado.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar", "admin_menu")]]
        }
      });
      return;
    }

    const usuario = await buscarUsuario(userId);
    if (!usuario) {
      await ctx.editMessageText("❌ Erro: Usuário não encontrado.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar", "admin_menu")]]
        }
      });
      return;
    }

    // Gerar um gift com o valor do login
    const valorLogin = precosPorLoja[login.loja] || 0;
    const codigoGift = gerarCodigoAleatorio();
    await salvarGift(codigoGift, valorLogin);

    // Atualizar o status do login
    const { error: updateError } = await supabase
      .from('logins')
      .update({ status: 'trocado' })
      .eq('id', loginId);

    if (updateError) {
      console.error("Erro ao atualizar status do login:", updateError);
      await ctx.editMessageText("❌ Erro ao processar a troca. Por favor, tente novamente.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar", "admin_menu")]]
        }
      });
      return;
    }

    // Notificar o usuário
    const mensagemUsuario = `
✅ *Troca de Login Aprovada*

Sua solicitação de troca do login ${login.email} (${login.loja}) foi aprovada.
Um gift no valor de ${formatarMoeda(valorLogin)} foi gerado para você.

🎟 Código do Gift: ${codigoGift}

Use o comando /resgata ${codigoGift} para adicionar o valor ao seu saldo.
    `;

    try {
      await bot.telegram.sendMessage(userId, mensagemUsuario, { parse_mode: 'Markdown' });
    } catch (sendError) {
      console.error("Erro ao enviar mensagem para o usuário:", sendError);
      await ctx.editMessageText("⚠️ A troca foi processada, mas não foi possível notificar o usuário. Por favor, informe-o manualmente.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar", "admin_menu")]]
        }
      });
      return;
    }

    // Confirmar para o admin
    await ctx.editMessageText(`
✅ Troca de login processada com sucesso!

Um gift no valor de ${formatarMoeda(valorLogin)} foi enviado para o usuário.
Login trocado: ${login.email} (${login.loja})
    `, {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu Admin", "admin_menu")]]
      }
    });

  } catch (error) {
    console.error("Erro ao processar troca de login:", error);
    await ctx.editMessageText("❌ Ocorreu um erro ao processar a troca de login. Por favor, tente novamente ou verifique os logs.", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar", "admin_menu")]]
      }
    });
  }
});

// Funções auxiliares
async function buscarLogin(loginId) {
  const { data, error } = await supabase
    .from('logins')
    .select('*')
    .eq('id', loginId)
    .single();

  if (error) throw error;
  return data;
}

async function atualizarStatusLogin(loginId, novoStatus) {
  const { error } = await supabase
    .from('logins')
    .update({ status: novoStatus })
    .eq('id', loginId);

  if (error) throw error;
}

function criarTabelaASCII(linhas) {
  const larguraColuna1 = Math.max(...linhas.map(l => l[0].length)) + 2;
  const larguraColuna2 = Math.max(...linhas.map(l => l[1].length)) + 2;

  let tabela = '+' + '-'.repeat(larguraColuna1) + '+' + '-'.repeat(larguraColuna2) + '+\n';
  tabela += '| ' + 'Categoria'.padEnd(larguraColuna1 - 1) + '| ' + 'Preço'.padEnd(larguraColuna2 - 1) + '|\n';
  tabela += '+' + '-'.repeat(larguraColuna1) + '+' + '-'.repeat(larguraColuna2) + '+\n';
  
  linhas.forEach(linha => {
    tabela += '| ' + linha[0].padEnd(larguraColuna1 - 1) + '| ' + linha[1].padEnd(larguraColuna2 - 1) + '|\n';
  });

  tabela += '+' + '-'.repeat(larguraColuna1) + '+' + '-'.repeat(larguraColuna2) + '+';
  return tabela;
}

const buscarUsuario = async (telegramId) => {
  try {
    let { data: usuario, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        const novoUsuario = {
          telegram_id: telegramId,
          saldo: 0
        };

        const { data: novoData, error: insertError } = await supabase
          .from('usuarios')
          .insert([novoUsuario])
          .select();

        if (insertError) throw new Error(`Falha ao criar novo usuário: ${insertError.message}`);
        return novoData[0];
      } else {
        throw new Error(`Falha ao buscar usuário: ${error.message}`);
      }
    }

    return usuario;
  } catch (error) {
    console.error(`Erro inesperado ao buscar/criar usuário ${telegramId}:`, error);
    throw error;
  }
};

const atualizarSaldoUsuario = async (telegramId, novoSaldo) => {
  try {
    const saldoAjustado = Math.min(Math.round(novoSaldo * 100) / 100, 99999999.99);
    const { error } = await supabase
      .from('usuarios')
      .update({ saldo: saldoAjustado })
      .eq('telegram_id', telegramId);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Erro ao atualizar saldo do usuário ${telegramId}:`, error);
    return false;
  }
};

const buscarCartao = async (cartaoId) => {
  try {
    const { data, error } = await supabase
      .from('cartoes_virtuais')
      .select('*')
      .eq('id', cartaoId)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`Erro ao buscar cartão ${cartaoId}:`, error);
    return null;
  }
};

const atualizarStatusCartao = async (cartaoId, novoStatus, compradorId) => {
  try {
    const { error } = await supabase
      .from('cartoes_virtuais')
      .update({
        status: novoStatus,
        comprador_id: compradorId,
        data_venda: new Date().toISOString()
      })
      .eq('id', cartaoId);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Erro ao atualizar status do cartão ${cartaoId}:`, error);
    return false;
  }
};

const buscarCategoria = async (categoriaId) => {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .eq('id', categoriaId)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`Erro ao buscar categoria ${categoriaId}:`, error);
    return null;
  }
};

const salvarGift = async (codigo, valor) => {
  try {
    const { error } = await supabase
      .from('gifts')
      .insert({ codigo, valor, usado: false });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Erro ao salvar gift ${codigo}:`, error);
    return false;
  }
};

const buscarGift = async (codigo) => {
  try {
    const { data, error } = await supabase
      .from('gifts')
      .select('*')
      .eq('codigo', codigo)
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`Erro ao buscar gift ${codigo}:`, error);
    return null;
  }
};

const marcarGiftComoUsado = async (codigo) => {
  try {
    const { error } = await supabase
      .from('gifts')
      .update({ usado: true })
      .eq('codigo', codigo);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Erro ao marcar gift ${codigo} como usado:`, error);
    return false;
  }
};

// Funções para logins
async function buscarLoginsDisponiveis() {
  const { data, error } = await supabase
    .from('logins')  // Certifique-se de que está usando 'logins' aqui
    .select('*')
    .eq('status', 'disponivel');

  if (error) throw error;
  return data;
}

function agruparLoginsPorLoja(logins) {
  return logins.reduce((acc, login) => {
    if (!acc[login.loja]) {
      acc[login.loja] = [];
    }
    acc[login.loja].push(login);
    return acc;
  }, {});
}

// Comandos do Bot
bot.command('start', async (ctx) => {
  console.log(`👤 Usuário ${ctx.from.id} iniciou o bot. Timestamp: ${new Date().toISOString()}`);
  try {
    let isMember = false;
    try {
      const chatMember = await ctx.telegram.getChatMember(GRUPO_ID, ctx.from.id);
      isMember = ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
      console.error('Erro ao verificar membro do grupo:', error);
      isMember = false;
    }

    if (!isMember) {
      await ctx.reply(`
🔒 *ACESSO NEURAL BLOQUEADO* 🔒

⚠️ Alerta de Segurança: Conexão não autorizada detectada!

Para estabelecer uma conexão segura com a Interface Neural A&D, é necessário integrar-se à nossa rede principal:

🔗 [Iniciar Protocolo de Integração](https://t.me/YzpacAvisos)

Instruções de Sincronização:
1. Acesse o link acima
2. Complete o processo de integração à rede
3. Retorne e execute o comando /start para inicializar a interface

⚡ Aguardando autenticação do usuário...`, { parse_mode: 'Markdown', disable_web_page_preview: true });
      return;
    }

    let usuario = await buscarUsuario(ctx.from.id);
    if (!usuario) {
      await ctx.reply('❌ Erro ao acessar seu perfil. Por favor, tente novamente em alguns instantes ou contate o suporte.');
      return;
    }

    const { count, error } = await supabase
      .from('cartoes_virtuais')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'disponivel');

    if (error) throw error;

    const mensagem = `
🔴 *INICIALIZANDO INTERFACE NEURAL A&D CARDS* 🔴

Saudações, Operador *${ctx.from.first_name}*! 👁️‍🗨️

📊 *STATUS DO SEU PERFIL NEURAL*
💼 Créditos: *${formatarMoeda(usuario.saldo)}*
🃏 CCs Disponíveis na Rede: *${count}*

🚀 Selecione uma operação para prosseguir:
    `;

    const imagemPath = path.join(__dirname, 'assets', 'bemvindo.jpg');

    await ctx.replyWithPhoto(
      { source: imagemPath },
      {
        caption: mensagem,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("🔺 ADQUIRIR CC+CPF 🔺", "comprar")],
            
            [Markup.button.callback("👤 Interface Neural", "perfil"), Markup.button.callback("💠 Injetar Créditos", "recarga")],
            [Markup.button.callback("📡 Log de Transações", "historico")],
            [Markup.button.callback("☎️ Suporte Técnico", "suporte")]
          ]
        }
      }
    ).catch(error => {
      console.error('Erro ao enviar foto:', error);
      ctx.reply(mensagem, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("🔺 ADQUIRIR CC+CPF 🔺", "comprar")],
            
            [Markup.button.callback("👤 Interface Neural", "perfil"), Markup.button.callback("💠 Injetar Créditos", "recarga")],
            [Markup.button.callback("📡 Log de Transações", "historico")],
            [Markup.button.callback("☎️ Suporte Técnico", "suporte")]
          ]
        }
      });
    });
  } catch (error) {
    console.error('Erro ao iniciar:', error);
    await ctx.reply('❌ Ocorreu um erro ao iniciar. Por favor, tente novamente com /start');
  }
});

bot.action('perfil', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const usuario = await buscarUsuario(ctx.from.id);
    if (!usuario) {
      await ctx.reply("⚠️ Perfil não encontrado. Por favor, inicie o bot novamente com /start.");
      return;
    }

    const dataIntegracao = usuario.created_at ? new Date(usuario.created_at).toLocaleDateString() : 'Data não disponível';

    const mensagem = `
👤 *INTERFACE NEURAL - DADOS DO OPERADOR*

🆔 ID de Acesso: \`${ctx.from.id}\`
💰 Créditos Disponíveis: ${formatarMoeda(usuario.saldo)}
📅 Data de Integração: ${dataIntegracao}

🛠️ *OPERAÇÕES DISPONÍVEIS:*
    `;

    const teclado = {
      inline_keyboard: [
        [Markup.button.callback("💳 Injetar Créditos", "recarga"), Markup.button.callback("📜 Log de Transações", "historico")],
        [Markup.button.callback("🔙 Voltar ao Menu Principal", "voltar_menu")]
      ]
    };

    try {
      // Tenta editar a mensagem existente
      await ctx.editMessageText(mensagem, {
        parse_mode: 'Markdown',
        reply_markup: teclado
      });
    } catch (editError) {
      console.log("Não foi possível editar a mensagem, enviando nova mensagem");
      // Se falhar ao editar, envia uma nova mensagem
      await ctx.reply(mensagem, {
        parse_mode: 'Markdown',
        reply_markup: teclado
      });
    }
  } catch (error) {
    console.error("Erro ao buscar perfil:", error);
    await ctx.reply("❌ Erro ao carregar perfil. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu Principal", "voltar_menu")]]
      }
    });
  }
});

bot.action('comprar', async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const mensagem = `
    ⚡ *INTERFACE NEURAL: SELEÇÃO DE AQUISIÇÃO* ⚡
    
    🖥️ Operador, escolha seu método de extração de dados:
    
    🔴  *UNITÁRIA*: Acesso preciso. Selecione a categoria desejada.
       Infiltração cirúrgica em sistemas específicos.
    
    🔴  *MIX*: Extração em massa. Lotes aleatórios a preço fixo.
       Ataque de amplo espectro para coleta diversificada.
    
    🔒 Aguardando input para iniciar sequência de aquisição...
    `;

    const teclado = [
      [Markup.button.callback("🔂 Compra Unitária", "compra_unitaria")],
      [Markup.button.callback("🔀 Compra Mix", "compra_mix")],
      [Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]
    ];

    try {
      // Tenta editar a mensagem existente
      await ctx.editMessageText(mensagem, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: teclado }
      });
    } catch (editError) {
      console.log("Não foi possível editar a mensagem, enviando nova mensagem");
      // Se falhar ao editar, envia uma nova mensagem
      await ctx.reply(mensagem, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: teclado }
      });
    }
  } catch (error) {
    console.error("Erro ao mostrar opções de compra:", error);
    await ctx.reply("❌ Falha ao carregar opções. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]]
      }
    });
  }
});

bot.action('compra_unitaria', async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const { data: cartoes, error: cartoesError } = await supabase
      .from('cartoes_virtuais')
      .select('*')
      .eq('status', 'disponivel');

    if (cartoesError) throw cartoesError;

    const niveisContagem = cartoes.reduce((acc, cartao) => {
      if (!acc[cartao.nivel]) {
        acc[cartao.nivel] = { nivel: cartao.nivel, count: 0 };
      }
      acc[cartao.nivel].count++;
      return acc;
    }, {});

    const niveisContagemArray = Object.values(niveisContagem);

    if (niveisContagemArray.length === 0) {
      await ctx.editMessageText('⚠️ Nenhuma categoria de cartão disponível no momento.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar", "comprar")]]
        }
      });
      return;
    }

    const linhasTabela = niveisContagemArray.map(item => [
      `💳 ${item.nivel.toUpperCase()}`,
      `${formatarMoeda(precosPorNivel[item.nivel] || 0)} (${item.count})`
    ]);

    const tabelaCategorias = criarTabelaASCII(linhasTabela);
    const tecladoCategorias = niveisContagemArray.map(item => [
      Markup.button.callback(
        `💳 ${item.nivel.toUpperCase()} - ${formatarMoeda(precosPorNivel[item.nivel] || 0)} (${item.count})`, 
        `categoria_${item.nivel}`
      )
    ]);
    tecladoCategorias.push([Markup.button.callback("🔙 Voltar", "comprar")]);

    const mensagem = `🛍️ *Categorias Disponíveis*\n\n\`\`\`\n${tabelaCategorias}\n\`\`\`\n\n📌 Selecione uma categoria para ver os cartões:`;

    await ctx.editMessageText(mensagem, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: tecladoCategorias }
    });
  } catch (error) {
    console.error("Erro ao buscar categorias:", error);
    await ctx.editMessageText("❌ Falha ao carregar categorias. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar", "comprar")]]
      }
    });
  }
});

bot.action('compra_mix', async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const mensagem = `
🔀 *COMPRA MIX DE CCs* 🔀

Escolha a quantidade de CCs que deseja comprar:

Preço fixo: R$ 10,00 por CC

Selecione uma opção:
    `;

    const teclado = [
      [Markup.button.callback("5 CCs - R$ 50,00", "mix_5")],
      [Markup.button.callback("10 CCs - R$ 100,00", "mix_10")],
      [Markup.button.callback("20 CCs - R$ 200,00", "mix_20")],
      [Markup.button.callback("50 CCs - R$ 500,00", "mix_50")],
      [Markup.button.callback("100 CCs - R$ 1000,00", "mix_100")],
      [Markup.button.callback("🔙 Voltar", "comprar")]
    ];

    await ctx.editMessageText(mensagem, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: teclado }
    });
  } catch (error) {
    console.error("Erro ao mostrar opções de mix:", error);
    await ctx.reply("❌ Falha ao carregar opções de mix. Tente novamente!");
  }
});

bot.action(/mix_(\d+)/, async (ctx) => {
  const quantidade = parseInt(ctx.match[1]);
  const valorTotal = quantidade * 10; // R$ 10 por CC

  try {
    await ctx.answerCbQuery();

    const usuario = await buscarUsuario(ctx.from.id);
    if (usuario.saldo < valorTotal) {
      await ctx.editMessageText(`❌ Saldo insuficiente. Você precisa de ${formatarMoeda(valorTotal)} para esta compra.`, {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar", "compra_mix")]]
        }
      });
      return;
    }

    const { data: cartoesDisponiveis, error } = await supabase
      .from('cartoes_virtuais')
      .select('*')
      .eq('status', 'disponivel')
      .limit(quantidade);

    if (error || cartoesDisponiveis.length < quantidade) {
      await ctx.editMessageText("❌ Não há cartões suficientes disponíveis para esta compra.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar", "compra_mix")]]
        }
      });
      return;
    }

    // Processar a compra
    const novoSaldo = usuario.saldo - valorTotal;
    await atualizarSaldoUsuario(ctx.from.id, novoSaldo);

    let mensagem = `
🔓 *AQUISIÇÃO NEURAL MIX CONCLUÍDA* 🔓

📊 *Resumo da Operação:*
🔢 Quantidade: ${quantidade} CCs
💰 Valor Total: ${formatarMoeda(valorTotal)}
💼 Novo Saldo: ${formatarMoeda(novoSaldo)}

🔍 *Detalhes dos Dados Neurais Adquiridos:*
`;

    for (let i = 0; i < cartoesDisponiveis.length; i++) {
      const cartao = cartoesDisponiveis[i];
      await atualizarStatusCartao(cartao.id, 'vendido', ctx.from.id);

      mensagem += `
🔹 *CC #${i + 1}*
\`\`\`
ID: ${cartao.numero_cartao}
Validade: ${cartao.mes_validade}/${cartao.ano_validade}
CVV: ${cartao.cvv}
Nível: ${cartao.nivel.toUpperCase()}
Banco: ${cartao.banco}
CPF: ${cartao.cpfs || 'N/A'}
\`\`\`
`;
    }

    mensagem += `
⚠️ *Instruções de Segurança:*
• Mantenha estes dados em sigilo absoluto.
• Utilize em até 24 horas para máxima eficácia.
• Em caso de falha, solicite troca imediatamente.

🔐 Boa sorte em suas operações, Operador!
`;

    const teclado = [
    
      [Markup.button.callback("🛒 Comprar Mais", "comprar")],
      [Markup.button.callback("🏠 Menu Principal", "voltar_menu")]
    ];

    await ctx.editMessageText(mensagem, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: teclado }
    });

  } catch (error) {
    console.error("Erro ao processar compra mix:", error);
    await ctx.editMessageText("❌ Ocorreu um erro ao processar sua compra. Por favor, tente novamente.", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar", "compra_mix")]]
      }
    });
  }
});
bot.action(/categoria_(.+)/, async (ctx) => {
  const nivel = ctx.match[1];
  try {
    const { data: produtos, error } = await supabase
      .from('cartoes_virtuais')
      .select('*')
      .eq('nivel', nivel)
      .eq('status', 'disponivel');

    if (error) throw error;

    if (!produtos || produtos.length === 0) {
      await ctx.answerCbQuery("Nenhum cartão disponível nesta categoria.");
      await ctx.editMessageText("⚠️ Nenhum cartão disponível nesta categoria.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar às Categorias", "comprar")]]
        }
      });
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.produtos = produtos;
    ctx.session.indexAtual = 0;
    ctx.session.nivel = nivel;

    await ctx.answerCbQuery();
    await exibirProduto(ctx);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    await ctx.answerCbQuery("Erro ao carregar produtos.");
    await ctx.editMessageText("❌ Falha ao carregar produtos. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar às Categorias", "comprar")]]
      }
    });
  }
});

const exibirProduto = async (ctx) => {
  try {
    const sessao = ctx.session;
    if (!sessao || !sessao.produtos) {
      await ctx.editMessageText("⏳ Sessão expirada. Use /start para recomeçar.");
      return;
    }

    const produto = sessao.produtos[sessao.indexAtual];
    if (!produto) {
      await ctx.editMessageText("❌ Erro ao carregar produto. Tente novamente!", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar às Categorias", "comprar")]]
        }
      });
      return;
    }

    const mensagem = criarTabelaASCII([
      ['⚡ ID', `${produto.numero_cartao.substring(0,6)}********`],
      ['🕒 Validade', `${produto.mes_validade}/${produto.ano_validade}`],
      ['🏢 Corporação', produto.banco],
      ['💠 Nível', produto.nivel.toUpperCase()],
      ['💰 Custo', formatarMoeda(precosPorNivel[produto.nivel] || 0)]
    ]);

    const botoesPaginacao = [];
    if (sessao.indexAtual > 0) {
      botoesPaginacao.push(Markup.button.callback("⬅️ Anterior", "anterior"));
    }
    botoesPaginacao.push(Markup.button.callback("🛒 Comprar", `comprar_${produto.id}`));
    if (sessao.indexAtual < sessao.produtos.length - 1) {
      botoesPaginacao.push(Markup.button.callback("Próximo ➡️", "proximo"));
    }

    const teclado = [
      botoesPaginacao,
      [Markup.button.callback("🔙 Voltar às Categorias", "comprar")]
    ];

    await ctx.editMessageText(`🔴 *CC ${produto.nivel.toUpperCase()} DETECTADO* 🔴\n\n\`\`\`\n${mensagem}\n\`\`\`\n\n🔍 Navegue pelo banco de dados: (${sessao.indexAtual + 1}/${sessao.produtos.length})`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: teclado }
    });
  } catch (error) {
    console.error("Erro ao exibir produto:", error);
    await ctx.editMessageText("❌ Erro ao exibir produto. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar às Categorias", "comprar")]]
      }
    });
  }
};

bot.action('anterior', async (ctx) => {
  try {
    if (ctx.session && ctx.session.produtos && ctx.session.indexAtual > 0) {
      ctx.session.indexAtual--;
      await ctx.answerCbQuery();
      await exibirProduto(ctx);
    } else {
      await ctx.answerCbQuery("Você já está no primeiro produto.");
    }
  } catch (error) {
    console.error("Erro na ação 'anterior':", error);
    await ctx.answerCbQuery("Ocorreu um erro. Tente novamente.");
  }
});

bot.action('proximo', async (ctx) => {
  try {
    if (ctx.session && ctx.session.produtos && ctx.session.indexAtual < ctx.session.produtos.length - 1) {
      ctx.session.indexAtual++;
      await ctx.answerCbQuery();
      await exibirProduto(ctx);
    } else {
      await ctx.answerCbQuery("Você já está no último produto.");
    }
  } catch (error) {
    console.error("Erro na ação 'proximo':", error);
    await ctx.answerCbQuery("Ocorreu um erro. Tente novamente.");
  }
});

bot.action(/comprar_(\d+)/, async (ctx) => {
  const produtoId = ctx.match[1];
  try {
    await ctx.answerCbQuery(`Iniciando processo de aquisição do CC ID: ${produtoId}`);

    const usuario = await buscarUsuario(ctx.from.id);
    const produto = await buscarCartao(produtoId);

    if (!produto || produto.status !== 'disponivel') {
      await ctx.editMessageText("❌ Este cartão não está mais disponível.");
      return;
    }

    const precoCartao = precosPorNivel[produto.nivel] || 0;

    if (usuario.saldo < precoCartao) {
      await ctx.editMessageText("❌ Saldo insuficiente para realizar esta aquisição.");
      return;
    }

    const novoSaldo = usuario.saldo - precoCartao;
    await atualizarSaldoUsuario(ctx.from.id, novoSaldo);
    await atualizarStatusCartao(produtoId, 'vendido', ctx.from.id);

    const mensagemConfirmacao = `
🔓 *DADO NEURAL ENTREGUE COM SUCESSO* 🔓

⚡ *Detalhes da Aquisição:*
\`\`\`
ID Neural: ${produto.numero_cartao}
Validade: ${produto.mes_validade}/${produto.ano_validade}
CVV: ${produto.cvv}
Nível: ${produto.nivel.toUpperCase()}
Banco: ${produto.banco}
CPF Vinculado: ${produto.cpfs || 'Não disponível'}
\`\`\`

💰 Custo da Operação: ${formatarMoeda(precoCartao)}
💼 Saldo Restante: ${formatarMoeda(novoSaldo)}

🔐 Mantenha estes dados em segurança. Boa sorte em suas operações!
    `;

    await ctx.editMessageText(mensagemConfirmacao, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("🔄 Solicitar Troca", `solicitar_troca_${produtoId}`)],
          [Markup.button.callback("🔙 Voltar às Categorias", "comprar")],
          [Markup.button.callback("🏠 Menu Principal", "voltar_menu")]
        ]
      }
    });

    try {
      await bot.telegram.sendMessage(GRUPO_ID, `
🎉 *Nova Aquisição Neural Realizada!* 🎉

💳 CC Nível: ${produto.nivel.toUpperCase()}
💰 Valor: ${formatarMoeda(precoCartao)}
🕒 Timestamp: ${new Date().toLocaleString()}

Operação concluída com sucesso!
      `, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error("Erro ao notificar grupo sobre a venda:", error);
    }

  } catch (error) {
    console.error("Erro ao processar compra:", error);
    await ctx.editMessageText("❌ Ocorreu um erro ao processar sua aquisição. Por favor, tente novamente ou contate o suporte.", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar às Categorias", "comprar")]]
      }
    });
  }
});

bot.action('cancel_buy', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("🛒 Compra cancelada. Volte sempre!", {
    reply_markup: {
      inline_keyboard: [
        [Markup.button.callback("🔙 Voltar às Categorias", "comprar")],
        [Markup.button.callback("🏠 Voltar ao Menu Principal", "voltar_menu")]
      ]
    }
  });
});

bot.command('post', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Você não tem permissão para usar este comando.");
    return;
  }

  const parts = ctx.message.text.split(' ');
  const imageUrl = parts[1];
  const messageText = parts.slice(2).join(' ');

  if (!imageUrl || !messageText) {
    await ctx.reply("❌ Uso incorreto. Use: /post [URL da imagem] [Sua mensagem aqui]");
    return;
  }

  try {
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('telegram_id');

    if (error) throw error;

    let sucessos = 0;
    let falhas = 0;

    for (const usuario of usuarios) {
      try {
        await bot.telegram.sendPhoto(usuario.telegram_id, imageUrl, {
          caption: `[@${usuario.telegram_id}](tg://user?id=${usuario.telegram_id})\n\n${messageText}`,
          parse_mode: 'Markdown'
        });
        sucessos++;
      } catch (error) {
        console.error(`Erro ao enviar mensagem para o usuário ${usuario.telegram_id}:`, error);
        falhas++;
      }
    }

    await bot.telegram.sendPhoto(GRUPO_ID, imageUrl, {
      caption: messageText,
      parse_mode: 'Markdown'
    });

    await ctx.reply(`✅ Mensagem com imagem enviada com sucesso!\nEnviadas individualmente: ${sucessos}\nFalhas: ${falhas}\nPostada no grupo.`);
  } catch (error) {
    console.error("Erro ao buscar usuários ou enviar mensagens:", error);
    await ctx.reply("❌ Erro ao enviar mensagens. Por favor, tente novamente.");
  }
});

bot.action(/solicitar_troca_(\d+)/, async (ctx) => {
  const cartaoId = ctx.match[1];
  try {
    const usuario = await buscarUsuario(ctx.from.id);
    const cartao = await buscarCartao(cartaoId);

    if (!cartao) {
      await ctx.answerCbQuery("Erro: Cartão não encontrado.");
      return;
    }

    const mensagemAdmin = `
🔄 *Solicitação de Troca*

👤 Usuário: ${ctx.from.first_name} (ID: ${ctx.from.id})
💳 Cartão: ${cartao.numero_cartao}
🏦 Banco: ${cartao.banco}
💠 Nível: ${cartao.nivel.toUpperCase()}

Por favor, verifique e processe esta solicitação de troca.
    `;

    // Enviar mensagem apenas para o admin
    try {
      await bot.telegram.sendMessage(ADMIN_ID, mensagemAdmin, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("✅ Aceitar Troca", `aceitar_troca_${cartaoId}_${ctx.from.id}`)]
          ]
        }
      });

      // Confirmar para o usuário que solicitou a troca
      await ctx.answerCbQuery("Solicitação de troca enviada com sucesso!");
      await ctx.editMessageText(`
✅ Sua solicitação de troca foi enviada ao suporte.

Por favor, aguarde o processamento. Entraremos em contato em breve.
      `, {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("🏠 Voltar ao Menu Principal", "voltar_menu")]
          ]
        }
      });
    } catch (error) {
      console.error("Erro ao enviar mensagem para o admin:", error);
      await ctx.answerCbQuery("Erro ao processar solicitação. Tente novamente mais tarde.");
    }

  } catch (error) {
    console.error("Erro ao solicitar troca:", error);
    await ctx.answerCbQuery("Erro ao processar solicitação de troca.");
  }
});

// Função para aceitar a troca (apenas para o admin)
bot.action(/aceitar_troca_(\d+)_(\d+)/, async (ctx) => {
  // Verificar se quem está respondendo é o admin
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery("Apenas o administrador pode aceitar trocas.");
    return;
  }

  const cartaoId = ctx.match[1];
  const userId = ctx.match[2];

  try {
    const cartao = await buscarCartao(cartaoId);
    if (!cartao) {
      await ctx.answerCbQuery("Erro: Cartão não encontrado.");
      return;
    }

    // Processar a troca (exemplo: gerar um novo cartão ou creditar o valor)
    const valorGift = precosPorNivel[cartao.nivel] || 0;
    const codigoGift = gerarCodigoAleatorio();
    await salvarGift(codigoGift, valorGift);

    // Notificar o usuário
    const mensagemUsuario = `
✅ *Troca Aprovada*

Sua solicitação de troca foi aprovada. Um gift no valor de ${formatarMoeda(valorGift)} foi gerado para você.

🎟 Código do Gift: ${codigoGift}

Use o comando /resgata ${codigoGift} para adicionar o valor ao seu saldo.
    `;

    await bot.telegram.sendMessage(userId, mensagemUsuario, { parse_mode: 'Markdown' });

    // Confirmar para o admin
    await ctx.answerCbQuery("Troca processada com sucesso!");
    await ctx.editMessageText(`
✅ Troca processada com sucesso!

Um gift no valor de ${formatarMoeda(valorGift)} foi enviado para o usuário.
    `);

  } catch (error) {
    console.error("Erro ao processar troca:", error);
    await ctx.answerCbQuery("Erro ao processar troca.");
  }
});

bot.action('comprar_login', async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const logins = await buscarLoginsDisponiveis();
    const loginsPorLoja = agruparLoginsPorLoja(logins);

    if (Object.keys(loginsPorLoja).length === 0) {
      await ctx.editMessageText('⚠️ Nenhum login disponível no momento.', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]]
        }
      });
      return;
    }

    const linhasTabela = Object.entries(loginsPorLoja).map(([loja, loginsLoja]) => [
      `🔐 ${loja || 'Desconhecido'}`,
      `${formatarMoeda(precosPorLoja[loja] || 0)} (${loginsLoja.length})`
    ]);

    const tabelaCategorias = criarTabelaASCII(linhasTabela);

    const tecladoCategorias = Object.entries(loginsPorLoja).map(([loja, loginsLoja]) => [
      Markup.button.callback(
        `🔐 ${loja || 'Desconhecido'} - ${formatarMoeda(precosPorLoja[loja] || 0)} (${loginsLoja.length})`,
        `loja_${loja}`
      )
    ]);
    tecladoCategorias.push([Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]);

    const mensagem = `🛍️ *Logins Disponíveis por Loja*\n\n\`\`\`\n${tabelaCategorias}\n\`\`\`\n\n📌 Selecione uma loja:`;

    try {
      await ctx.editMessageText(mensagem, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: tecladoCategorias }
      });
    } catch (editError) {
      console.error("Erro ao editar mensagem:", editError);
      // Se falhar ao editar, envia uma nova mensagem
      await ctx.reply(mensagem, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: tecladoCategorias }
      });
    }
  } catch (error) {
    console.error("Erro ao buscar logins:", error);
    await ctx.editMessageText("❌ Falha ao carregar logins. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]]
      }
    });
  }
});

bot.action(/loja_(.+)/, async (ctx) => {
  const loja = ctx.match[1];
  try {
    const logins = await buscarLoginsDisponiveis();
    const loginsDaLoja = logins.filter(login => login.loja === loja);

    if (loginsDaLoja.length === 0) {
      await ctx.answerCbQuery("Nenhum login disponível para esta loja.");
      await ctx.editMessageText("⚠️ Nenhum login disponível para esta loja.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")]]
        }
      });
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.logins = loginsDaLoja;
    ctx.session.indexAtual = 0;
    ctx.session.loja = loja;

    await ctx.answerCbQuery();
    await exibirLogin(ctx);
  } catch (error) {
    console.error("Erro ao buscar logins da loja:", error);
    await ctx.answerCbQuery("Erro ao carregar logins.");
    await ctx.editMessageText("❌ Falha ao carregar logins. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")]]
      }
    });
  }
});

const exibirLogin = async (ctx) => {
  try {
    const sessao = ctx.session;
    if (!sessao || !sessao.logins) {
      await ctx.editMessageText("⏳ Sessão expirada. Use /start para recomeçar.");
      return;
    }

    const login = sessao.logins[sessao.indexAtual];
    if (!login) {
      await ctx.editMessageText("❌ Erro ao carregar login. Tente novamente!", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")]]
        }
      });
      return;
    }

    const mensagem = criarTabelaASCII([
      ['🌐 Loja', login.loja],
      ['🔑 Plano', login.plano || 'N/A'],
      ['📍 Região', login.regiao || 'N/A'],
      ['💰 Preço', formatarMoeda(precosPorLoja[login.loja] || 0)]
    ]);

    const botoesPaginacao = [];
    if (sessao.indexAtual > 0) {
      botoesPaginacao.push(Markup.button.callback("⬅️ Anterior", "anterior_login"));
    }
    botoesPaginacao.push(Markup.button.callback("🛒 Comprar", `comprar_login_${login.id}`));
    if (sessao.indexAtual < sessao.logins.length - 1) {
      botoesPaginacao.push(Markup.button.callback("Próximo ➡️", "proximo_login"));
    }

    const teclado = [
      botoesPaginacao,
      [Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")]
    ];

    await ctx.editMessageText(
      `🔐 *LOGIN ${login.loja} DISPONÍVEL* 🔐\n\n\`\`\`\n${mensagem}\n\`\`\`\n\n🔍 Navegue pelos logins: (${sessao.indexAtual + 1}/${sessao.logins.length})`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: teclado }
      }
    );
  } catch (error) {
    console.error("Erro ao exibir login:", error);
    await ctx.editMessageText("❌ Erro ao exibir login. Tente novamente!", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")]]
      }
    });
  }
};

bot.action('anterior_login', async (ctx) => {
  if (ctx.session?.logins && ctx.session.indexAtual > 0) {
    ctx.session.indexAtual--;
    await ctx.answerCbQuery();
    await exibirLogin(ctx);
  } else {
    await ctx.answerCbQuery("Você já está no primeiro login.");
  }
});

bot.action('proximo_login', async (ctx) => {
  if (ctx.session?.logins && ctx.session.indexAtual < ctx.session.logins.length - 1) {
    ctx.session.indexAtual++;
    await ctx.answerCbQuery();
    await exibirLogin(ctx);
  } else {
    await ctx.answerCbQuery("Você já está no último login.");
  }
});

bot.action(/comprar_login_(\d+)/, async (ctx) => {
  const loginId = ctx.match[1];
  try {
    await ctx.answerCbQuery(`Iniciando processo de aquisição do Login ID: ${loginId}`);

    const usuario = await buscarUsuario(ctx.from.id);
    const { data: login, error } = await supabase
      .from('logins')
      .select('*')
      .eq('id', loginId)
      .single();

    if (error || !login || login.status !== 'disponivel') {
      await ctx.editMessageText("❌ Este login não está mais disponível.", {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")]]
        }
      });
      return;
    }

    const precoLogin = precosPorLoja[login.loja] || 0;

    if (usuario.saldo < precoLogin) {
      await ctx.editMessageText("❌ Saldo insuficiente para realizar esta aquisição.", {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("💰 Adicionar Saldo", "recarga")],
            [Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")]
          ]
        }
      });
      return;
    }

    // Atualizar saldo do usuário
    const novoSaldo = usuario.saldo - precoLogin;
    await atualizarSaldoUsuario(ctx.from.id, novoSaldo);

    // Atualizar status do login
    await supabase
      .from('logins')
      .update({
        status: 'vendido',
        comprador_id: ctx.from.id,
        data_venda: new Date().toISOString()
      })
      .eq('id', loginId);

    // Mensagem de confirmação para o usuário
    const mensagemConfirmacao = `
🔓 *LOGIN ENTREGUE COM SUCESSO* 🔓

⚡ *Detalhes do Login:*
\`\`\`
Loja: ${login.loja}
Email: ${login.email}
Senha: ${login.senha}
Plano: ${login.plano || 'N/A'}
Região: ${login.regiao || 'N/A'}
\`\`\`

💰 Custo da Operação: ${formatarMoeda(precoLogin)}
💼 Saldo Restante: ${formatarMoeda(novoSaldo)}

🔐 Mantenha estes dados em segurança. Boa sorte em suas operações!
    `;

    await ctx.editMessageText(mensagemConfirmacao, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("🔄 Solicitar Troca", `solicitar_troca_login_${loginId}`)],
          [Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")],
          [Markup.button.callback("🏠 Menu Principal", "voltar_menu")]
        ]
      }
    });

    // Notificar o grupo sobre a venda
    try {
      await bot.telegram.sendMessage(GRUPO_ID, `
🎉 *Novo Login Adquirido!* 🎉

🏢 Loja: ${login.loja}
🎭 Plano: ${login.plano || 'N/A'}
🌍 Região: ${login.regiao || 'N/A'}
💰 Valor: ${formatarMoeda(precoLogin)}
🕒 Data: ${new Date().toLocaleString()}

Operação concluída com sucesso!
      `, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error("Erro ao notificar grupo sobre a venda do login:", error);
    }

  } catch (error) {
    console.error("Erro ao processar compra de login:", error);
    await ctx.editMessageText("❌ Ocorreu um erro ao processar sua aquisição. Por favor, tente novamente ou contate o suporte.", {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("🔙 Voltar às Lojas", "comprar_login")],
          [Markup.button.callback("☎️ Contatar Suporte", "suporte")]
        ]
      }
    });
  }
});
bot.action('recarga', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const mensagem = `
🔹 *INJEÇÃO DE CRÉDITOS NEURAIS* 🔹

Selecione o método de recarga:

1️⃣ PIX - Transferência Neural Instantânea
2️⃣ Cartão de Crédito - Interface de Pagamento Seguro

Para iniciar a recarga, use o comando:
/pix [valor] - Para recarga via PIX
Exemplo: /pix 50

💡 O valor mínimo para recarga é de ¤ 10.00
    `;

    await ctx.editMessageText(mensagem, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("🔙 Voltar ao Menu Principal", "voltar_menu")]
        ]
      }
    });
  } catch (error) {
    console.error('Erro ao mostrar opções de recarga:', error);
    await ctx.reply('Erro ao carregar opções de recarga. Tente novamente.');
  }
});

bot.action('historico', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const usuario = await buscarUsuario(ctx.from.id);
    
    if (!usuario) {
      await ctx.editMessageText('❌ Erro ao acessar seu perfil. Por favor, use /start para recomeçar.');
      return;
    }

    const { data: transacoes, error } = await supabase
      .from('transacoes')
      .select('*')
      .eq('usuario_id', usuario.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    let mensagemHistorico = `
🔹 *LOG DE TRANSAÇÕES NEURAIS* 🔹

Últimas 10 operações realizadas:
`;

    if (transacoes.length === 0) {
      mensagemHistorico += "\nNenhuma transação registrada.";
    } else {
      transacoes.forEach((transacao, index) => {
        const data = new Date(transacao.created_at).toLocaleString();
        const tipo = traduzirTipoTransacao(transacao.tipo);
        const valor = transacao.tipo === 'debito' ? `-${formatarMoeda(transacao.valor)}` : `+${formatarMoeda(transacao.valor)}`;
        
        mensagemHistorico += `
${index + 1}. ${tipo}
   Valor: ${valor}
   Data: ${data}
   ${transacao.detalhes ? `Detalhes: ${transacao.detalhes}` : ''}
`;
      });
    }

    mensagemHistorico += `
💼 Saldo Atual: ${formatarMoeda(usuario.saldo)}
`;

    const teclado = {
      inline_keyboard: [
        [Markup.button.callback("📊 Exportar Histórico Completo", "exportar_historico")],
        [Markup.button.callback("🔙 Voltar ao Menu Principal", "voltar_menu")]
      ]
    };

    await ctx.editMessageText(mensagemHistorico, {
      parse_mode: 'Markdown',
      reply_markup: teclado
    });
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    await ctx.editMessageText('Erro ao carregar histórico. Tente novamente.', {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu Principal", "voltar_menu")]]
      }
    });
  }
});

function traduzirTipoTransacao(tipo) {
  const traducoes = {
    'credito': '💰 Crédito',
    'debito': '💸 Débito',
    'compra': '🛒 Compra',
    'gift': '🎁 Gift',
    'reembolso': '♻️ Reembolso'
  };
  return traducoes[tipo] || tipo;
}

bot.action('exportar_historico', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const usuario = await buscarUsuario(ctx.from.id);

    if (!usuario) {
      await ctx.editMessageText('❌ Erro ao acessar seu perfil. Por favor, use /start para recomeçar.');
      return;
    }

    const { data: transacoes, error } = await supabase
      .from('transacoes')
      .select('*')
      .eq('usuario_id', usuario.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    let csvContent = "Data,Tipo,Valor,Detalhes\n";
    transacoes.forEach(t => {
      const data = new Date(t.created_at).toLocaleString();
      const tipo = traduzirTipoTransacao(t.tipo);
      const valor = t.tipo === 'debito' ? `-${t.valor}` : t.valor;
      csvContent += `"${data}","${tipo}","${valor}","${t.detalhes || ''}"\n`;
    });

    const buffer = Buffer.from(csvContent, 'utf-8');
    await ctx.replyWithDocument({ source: buffer, filename: 'historico_transacoes.csv' });

    await ctx.editMessageText('✅ Histórico exportado com sucesso! Verifique o arquivo enviado.', {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Histórico", "historico")]]
      }
    });
  } catch (error) {
    console.error('Erro ao exportar histórico:', error);
    await ctx.editMessageText('Erro ao exportar histórico. Tente novamente.', {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Histórico", "historico")]]
      }
    });
  }
});

bot.action('suporte', async (ctx) => {
  const mensagem = `
📞 *Suporte*

Precisa de ajuda? Entre em contato diretamente com o dono:

👤 @ANJOS_E_D3MONIOS

Estamos aqui para ajudar!
  `;

  await ctx.answerCbQuery();
  await ctx.editMessageText(mensagem, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[Markup.button.callback("🔙 Voltar ao Menu", "voltar_menu")]]
    }
  });
});

bot.action('voltar_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    let usuario = await buscarUsuario(ctx.from.id);
    if (!usuario) {
      await ctx.editMessageText('❌ Erro ao carregar perfil. Por favor, use /start para recomeçar.');
      return;
    }

    const { count, error } = await supabase
      .from('cartoes_virtuais')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'disponivel');

    if (error) throw error;

    const mensagem = `
🔴 *INICIALIZANDO INTERFACE NEURAL A&D CARDS* 🔴

Saudações, Operador *${ctx.from.first_name}*! 👁️‍🗨️

📊 *STATUS DO SEU PERFIL NEURAL*
💼 Créditos: *${formatarMoeda(usuario.saldo)}*
🃏 CCs Disponíveis na Rede: *${count}*

🚀 Selecione uma operação para prosseguir:
    `;

    await ctx.editMessageText(mensagem, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("🔺 ADQUIRIR CC+CPF 🔺", "comprar")],
          //🔐 LOGIN C/PEDIDOS 🔐
          [Markup.button.callback("👤 Interface Neural", "perfil"), Markup.button.callback("💠 Injetar Créditos", "recarga")],
          [Markup.button.callback("📡 Log de Transações", "historico")],
          [Markup.button.callback("☎️ Suporte Técnico", "suporte")]
        ]
      }
    });
  } catch (error) {
    console.error('Erro ao voltar ao menu:', error);
    await ctx.editMessageText('❌ Erro ao carregar o menu. Por favor, use /start para recomeçar.');
  }
});

bot.command('pix', async (ctx) => {
  const valor = Number(ctx.message.text.split(' ')[1]);
  if (isNaN(valor) || valor < 10) {
    await ctx.reply("❌ Valor inválido. O valor mínimo é R$ 10.");
    return;
  }

  let valorFinal = valor;
  if (saldoDuplicadoAtivo) {
    valorFinal *= 2;
  }

  try {
    const usuario = await buscarUsuario(ctx.from.id);
    if (!usuario) {
      await ctx.reply("❌ Erro ao acessar seu perfil. Por favor, tente novamente ou contate o suporte.");
      return;
    }

    const payload = {
      closed: true,
      customer: {
        name: "Tony Stark",
        type: "individual",
        email: "avengerstark@ligadajustica.com.br",
        document: "03154435026",
        address: {
          line_1: "7221, Avenida Dra Ruth Cardoso, Pinheiro",
          line_2: "Prédio",
          zip_code: "05425070",
          city: "São Paulo",
          state: "SP",
          country: "BR"
        },
        phones: {
          home_phone: {
            country_code: "55",
            area_code: "11",
            number: "000000000"
          },
          mobile_phone: {
            country_code: "55",
            area_code: "11",
            number: "000000000"
          }
        }
      },
      items: [
        {
          amount: valorFinal * 100, // Convertendo para centavos
          description: "Adição de Saldo",
          quantity: 1,
          code: "123"
        }
      ],
      payments: [
        {
          payment_method: "pix",
          pix: {
            expires_in: "7200",
            additional_information: [
              {
                name: "Saldo",
                value: valorFinal.toString()
              }
            ]
          }
        }
      ]
    };

    const response = await axios.post('https://api.pagar.me/core/v5/orders', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(process.env.PAGARME_API_KEY + ':').toString('base64')}`
      }
    });

    const pixData = response.data;
    const qrCodeUrl = pixData.charges[0].last_transaction.qr_code_url;
    const qrCodeText = pixData.charges[0].last_transaction.qr_code;
    const orderId = pixData.id;

    // Enviando o QR code como imagem
    await ctx.replyWithPhoto({ url: qrCodeUrl });

    const mensagemPix = `
    🔐 *RECARGA NEURAL VIA PIX GERADA*
    
    💰 Valor a Transferir: ${formatarMoeda(valor)}
    ${saldoDuplicadoAtivo ? `🎉 Amplificador Neural Ativado! Você Receberá: ${formatarMoeda(valorFinal)}` : ''}
    
    📲 *Protocolo de Transferência:*
    1️⃣ Acesse seu terminal bancário
    2️⃣ Selecione a opção de pagamento PIX
    3️⃣ Escaneie o Código QR ou copie o código abaixo
    4️⃣ Confirme a transferência neural
    
    🔑 *Código PIX Neural:*
    \`${qrCodeText}\`
    
    ⏳ Aguardando confirmação da transferência...
    ⏱️ Este código expira em 2 horas.
    
    💡 Após a confirmação, seus créditos serão atualizados automaticamente.
    `;
    await ctx.reply(mensagemPix, { parse_mode: 'Markdown' });

    // Verificar o status do pagamento a cada 5 segundos
    const checkPaymentStatus = async () => {
      try {
        const statusResponse = await axios.get(`https://api.pagar.me/core/v5/orders/${orderId}`, {
          headers: {
            'Authorization': `Basic ${Buffer.from(process.env.PAGARME_API_KEY + ':').toString('base64')}`
          }
        });

        if (statusResponse.data.status === "paid") {
          clearInterval(intervalId);
          const novoSaldo = (usuario.saldo || 0) + valorFinal;
          await atualizarSaldoUsuario(ctx.from.id, novoSaldo);

          await ctx.reply(`
✅ *Pagamento Confirmado!*

💰 Valor recebido: ${formatarMoeda(valorFinal)}
💼 Novo saldo: ${formatarMoeda(novoSaldo)}

Obrigado pela recarga!
          `, { parse_mode: 'Markdown' });

          // Notificar o grupo sobre a recarga
          try {
            await bot.telegram.sendMessage(GRUPO_ID, `
🎉 *Nova Recarga Realizada!* 🎉

💰 Valor: ${formatarMoeda(valorFinal)}
🕒 Data: ${new Date().toLocaleString()}
${saldoDuplicadoAtivo ? '🔥 Bônus de Recarga Aplicado!' : ''}

Recarga concluída com sucesso!
            `, { parse_mode: 'Markdown' });
          } catch (error) {
            console.error("Erro ao notificar grupo sobre a recarga:", error);
          }
        }
      } catch (error) {
        console.error("Erro ao verificar status do pagamento:", error);
      }
    };

    const intervalId = setInterval(checkPaymentStatus, 5000);

    // Parar de verificar após 30 minutos
    setTimeout(() => {
      clearInterval(intervalId);
    }, 30 * 60 * 1000);

  } catch (error) {
    console.error("Erro ao gerar PIX:", error.response ? error.response.data : error.message);
    await ctx.reply("❌ Erro ao gerar pagamento. Tente novamente!");
  }
});
// Comandos de administração
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Acesso negado. Este comando é apenas para administradores.");
    return;
  }

  try {
    const stats = await coletarEstatisticasSimplificadas();



    const teclado = [
      [Markup.button.callback("📊 Relatório", "admin_relatorio"), Markup.button.callback("👥 Usuários", "admin_usuarios")],
      [Markup.button.callback("💳 Cartões", "admin_cartoes"), Markup.button.callback("🔐 Logins", "admin_logins")],
      [Markup.button.callback("🎁 Promoções", "admin_promocoes"), Markup.button.callback("💰 Finanças", "admin_financas")],
      [Markup.button.callback("⚙️ Configurações", "admin_config"), Markup.button.callback("📢 Broadcast", "admin_broadcast")]
    ];

    await ctx.replyWithMarkdownV2(mensagem, { 
      reply_markup: { inline_keyboard: teclado }
    });
  } catch (error) {
    console.error("Erro no painel de administração:", error);
    await ctx.reply("❌ Ocorreu um erro ao carregar o painel de administração. Por favor, tente novamente.");
  }
});

async function coletarEstatisticasSimplificadas() {
  const agora = new Date();
  const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000);

  try {
    const [
      { count: totalUsuarios },
      { count: cartoesDisponiveis },
      { count: loginsDisponiveis },
      { data: transacoes, error: transacoesError },
      { count: novosUsuarios24h },
      { count: transacoes24h }
    ] = await Promise.all([
      supabase.from('usuarios').select('*', { count: 'exact', head: true }),
      supabase.from('cartoes_virtuais').select('*', { count: 'exact', head: true }).eq('status', 'disponivel'),
      supabase.from('logins').select('*', { count: 'exact', head: true }).eq('status', 'disponivel'),
      supabase.from('transacoes').select('valor'),
      supabase.from('usuarios').select('*', { count: 'exact', head: true }).gte('created_at', ontem.toISOString()),
      supabase.from('transacoes').select('*', { count: 'exact', head: true }).gte('created_at', ontem.toISOString())
    ]);

    let faturamentoTotal = 0;
    if (!transacoesError && transacoes) {
      faturamentoTotal = transacoes.reduce((sum, t) => sum + (parseFloat(t.valor) || 0), 0);
    }

    return {
      totalUsuarios: totalUsuarios || 0,
      cartoesDisponiveis: cartoesDisponiveis || 0,
      loginsDisponiveis: loginsDisponiveis || 0,
      faturamentoTotal: faturamentoTotal,
      novosUsuarios24h: novosUsuarios24h || 0,
      transacoes24h: transacoes24h || 0
    };
  } catch (error) {
    console.error("Erro ao coletar estatísticas:", error);
    return {
      totalUsuarios: 0,
      cartoesDisponiveis: 0,
      loginsDisponiveis: 0,
      faturamentoTotal: 0,
      novosUsuarios24h: 0,
      transacoes24h: 0
    };
  }
}



// Função helper para formatar moeda (evitando caracteres especiais do Markdown)

// ... (o resto do código permanece o mesmo)
// Função helper para formatar moeda (evitando caracteres especiais do Markdown)

bot.command('2x', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Você não tem permissão para usar este comando.");
    return;
  }

  try {
    saldoDuplicadoAtivo = !saldoDuplicadoAtivo;
    const status = saldoDuplicadoAtivo ? "ativado" : "desativado";

    // Salvar o estado no banco de dados
    const { error } = await supabase
      .from('configuracoes')
      .upsert({ chave: 'saldo_duplicado', valor: saldoDuplicadoAtivo }, { onConflict: 'chave' });

    if (error) throw error;

    const mensagem = `
🎉 *Modo de Saldo Duplicado ${status}!* 🎉

${saldoDuplicadoAtivo ? "Todas as recargas serão dobradas!" : "As recargas voltaram ao normal."}

⏱️ Duração: ${saldoDuplicadoAtivo ? "Até ser desativado manualmente" : "N/A"}
👤 Ativado por: Admin ${ctx.from.first_name}
    `;

    await ctx.reply(mensagem, { parse_mode: 'Markdown' });

    // Notificar o grupo sobre a mudança
    try {
      await bot.telegram.sendMessage(GRUPO_ID, mensagem, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error("Erro ao notificar grupo sobre mudança no modo de saldo duplicado:", error);
      await ctx.reply("⚠️ Não foi possível notificar o grupo sobre esta mudança.");
    }

    // Registrar a ação no log de atividades administrativas
    await registrarAtividadeAdmin(ctx.from.id, `${status} modo de saldo duplicado`);

  } catch (error) {
    console.error("Erro ao alterar modo de saldo duplicado:", error);
    await ctx.reply("❌ Ocorreu um erro ao alterar o modo de saldo duplicado. Por favor, tente novamente.");
  }
});


function gerarMensagemPainelAdmin(stats) {
  return `
🛠 *Painel de Administração* 🛠

📊 *Estatísticas Gerais:*
👥 Usuários Totais: ${stats.totalUsuarios}
💳 Cartões Disponíveis: ${stats.cartoesDisponiveis}
🔐 Logins Disponíveis: ${stats.loginsDisponiveis}
💰 Faturamento Total: ${formatarMoeda(stats.faturamentoTotal)}

📈 *Atividade Recente:*
🆕 Novos Usuários \\(24h\\): ${stats.novosUsuarios24h}
💼 Transações \\(24h\\): ${stats.transacoes24h}

Use /admin\\_help para mais detalhes sobre os comandos\\.
`.replace(/[.]/g, '\\.');
}


bot.action('admin_estatisticas', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("Acesso não autorizado.");
    return;
  }

  // Implementar lógica para mostrar estatísticas detalhadas
  await ctx.answerCbQuery();
  await ctx.reply("Estatísticas detalhadas serão implementadas em breve.");
});

bot.action('admin_usuarios', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("Acesso não autorizado.");
    return;
  }

  // Implementar lógica para gerenciar usuários
  await ctx.answerCbQuery();
  await ctx.reply("Gerenciamento de usuários será implementado em breve.");
});

bot.action('admin_cartoes', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("Acesso não autorizado.");
    return;
  }

  // Implementar lógica para gerenciar cartões
  await ctx.answerCbQuery();
  await ctx.reply("Gerenciamento de cartões será implementado em breve.");
});

bot.action('admin_logins', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("Acesso não autorizado.");
    return;
  }

  // Implementar lógica para gerenciar logins
  await ctx.answerCbQuery();
  await ctx.reply("Gerenciamento de logins será implementado em breve.");
});

bot.action('admin_promocoes', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("Acesso não autorizado.");
    return;
  }

  // Implementar lógica para gerenciar promoções
  await ctx.answerCbQuery();
  await ctx.reply("Gerenciamento de promoções será implementado em breve.");
});
bot.command('preco', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Você não tem permissão para usar este comando.");
    return;
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length !== 2) {
    await ctx.reply("❌ Uso incorreto. Use: /preco [valor] [quantidade]");
    return;
  }

  const [valor, quantidade] = args.map(Number);
  if (isNaN(valor) || isNaN(quantidade) || valor <= 0 || quantidade <= 0) {
    await ctx.reply("❌ Valor ou quantidade inválidos. Ambos devem ser números positivos.");
    return;
  }

  try {
    // Salvar a promoção no banco de dados
    const { data, error } = await supabase
      .from('promocoes')
      .insert({
        valor: valor,
        quantidade_total: quantidade,
        quantidade_restante: quantidade,
        ativo: true,
        criado_por: ctx.from.id
      })
      .select()
      .single();

    if (error) throw error;

    promocaoAtiva = {
      id: data.id,
      valor: valor,
      quantidade: quantidade,
      vendidos: 0
    };

    const mensagem = `
🎊 *Nova Promoção Ativada!* 🎊

💰 Preço: ${formatarMoeda(valor)}
🔢 Quantidade: ${quantidade} cartões
🆔 ID da Promoção: ${data.id}

Aproveite enquanto durar!
    `;

    await ctx.reply(mensagem, { parse_mode: 'Markdown' });

    // Notificar o grupo sobre a nova promoção
    try {
      await bot.telegram.sendMessage(GRUPO_ID, mensagem, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error("Erro ao notificar grupo sobre nova promoção:", error);
      await ctx.reply("⚠️ Não foi possível notificar o grupo sobre esta promoção.");
    }

    // Registrar a ação no log de atividades administrativas
    await registrarAtividadeAdmin(ctx.from.id, `Criou nova promoção: ${quantidade} cartões por ${formatarMoeda(valor)}`);

  } catch (error) {
    console.error("Erro ao criar nova promoção:", error);
    await ctx.reply("❌ Ocorreu um erro ao criar a promoção. Por favor, tente novamente.");
  }
});


bot.command('gift', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("❌ Você não tem permissão para usar este comando.");
    return;
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length !== 1) {
    await ctx.reply("❌ Uso incorreto. Use: /gift [valor]");
    return;
  }

  const valor = Number(args[0]);
  if (isNaN(valor) || valor <= 0) {
    await ctx.reply("❌ Valor inválido. Por favor, insira um número positivo.");
    return;
  }

  try {
    const codigo = gerarCodigoAleatorio();
    
    // Salvar o gift no banco de dados
    const { data, error } = await supabase
      .from('gifts')
      .insert({
        codigo: codigo,
        valor: valor,
        usado: false
        // Removido o campo 'criado_por' que não existe na tabela
      })
      .select()
      .single();

    if (error) throw error;

    const mensagem = `
✨ *Novo Gift Gerado* ✨

💰 Valor: ${formatarMoeda(valor)}
🎟 Código: ${codigo}
🆔 ID do Gift: ${data.id}

Os usuários podem resgatar usando /resgata ${codigo}

⚠️ Este código é de uso único e expira em 24 horas.
    `;

    await ctx.reply(mensagem, { parse_mode: 'Markdown' });

    // Registrar a ação no log de atividades administrativas
    await registrarAtividadeAdmin(ctx.from.id, `Gerou gift de ${formatarMoeda(valor)} (Código: ${codigo})`);

    // Agendar expiração do gift após 24 horas
    setTimeout(async () => {
      const { error: expireError } = await supabase
        .from('gifts')
        .update({ expirado: true })
        .eq('id', data.id)
        .eq('usado', false);

      if (expireError) {
        console.error("Erro ao expirar gift:", expireError);
      }
    }, 24 * 60 * 60 * 1000); // 24 horas

  } catch (error) {
    console.error("Erro ao gerar gift:", error);
    await ctx.reply("❌ Ocorreu um erro ao gerar o gift. Por favor, tente novamente.");
  }
});





bot.command('setcardprice', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.reply("Acesso negado. Apenas administradores podem usar este comando.");
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
    await ctx.reply("Uso correto: /setcardprice [NIVEL] [PRECO]");
    return;
  }

  const nivel = args[1].toUpperCase();
  const preco = parseFloat(args[2]);

  if (isNaN(preco) || preco < 0) {
    await ctx.reply("Por favor, forneça um preço válido (número não negativo).");
    return;
  }

  if (!precosPorNivel.hasOwnProperty(nivel)) {
    await ctx.reply("Nível de cartão inválido. Níveis disponíveis: " + Object.keys(precosPorNivel).join(', '));
    return;
  }

  try {
    // Atualizar o preço no banco de dados
    const { error } = await supabase
      .from('precos_cartoes')
      .upsert({ 
        nivel: nivel, 
        preco: preco,
        atualizado_por: ctx.from.id,
        data_atualizacao: new Date().toISOString()
      }, { onConflict: 'nivel' });

    if (error) throw error;

    // Atualizar a variável global
    precosPorNivel[nivel] = preco;

    await ctx.reply(`✅ Preço do cartão ${nivel} atualizado para ${formatarMoeda(preco)}`);

    // Exibir todos os preços atuais
    let mensagemPrecos = "Preços atuais dos cartões:\n";
    for (const [nivelCard, precoCard] of Object.entries(precosPorNivel)) {
      mensagemPrecos += `${nivelCard}: ${formatarMoeda(precoCard)}\n`;
    }
    await ctx.reply(mensagemPrecos);

    // Registrar a ação no log de atividades administrativas
    await registrarAtividadeAdmin(ctx.from.id, `Atualizou preço do cartão ${nivel} para ${formatarMoeda(preco)}`);

    // Notificar outros administradores sobre a mudança de preço
    const mensagemNotificacao = `
🚨 *Atualização de Preço de Cartão* 🚨

Nível: ${nivel}
Novo Preço: ${formatarMoeda(preco)}
Atualizado por: Admin ${ctx.from.first_name}

Esta mudança já está em vigor.
    `;

    // Assumindo que você tem uma lista de IDs de administradores
    const adminIds = [ADMIN_ID]; // Adicione outros IDs de admin se necessário
    for (const adminId of adminIds) {
      if (adminId !== ctx.from.id) {
        try {
          await bot.telegram.sendMessage(adminId, mensagemNotificacao, { parse_mode: 'Markdown' });
        } catch (error) {
          console.error(`Erro ao notificar admin ${adminId}:`, error);
        }
      }
    }

  } catch (error) {
    console.error("Erro ao atualizar preço do cartão:", error);
    await ctx.reply("❌ Ocorreu um erro ao atualizar o preço. Por favor, tente novamente.");
  }
});

// Função auxiliar para registrar atividades administrativas (caso não tenha sido definida anteriormente)
async function registrarAtividadeAdmin(adminId, acao) {
  try {
    const { error } = await supabase
      .from('log_admin')
      .insert({
        admin_id: adminId,
        acao: acao,
        data: new Date().toISOString()
      });

    if (error) throw error;
  } catch (error) {
    console.error("Erro ao registrar atividade administrativa:", error);
  }
}


bot.command('resgata', async (ctx) => {
  const codigo = ctx.message.text.split(' ')[1];
  if (!codigo) {
    await ctx.reply("❌ Uso incorreto. Use: /resgata [codigo]");
    return;
  }

  try {
    // Buscar o gift
    const { data: gift, error: giftError } = await supabase
      .from('gifts')
      .select('*')
      .eq('codigo', codigo)
      .single();

    if (giftError || !gift) {
      await ctx.reply("❌ Código inválido ou não encontrado.");
      return;
    }

    if (gift.usado) {
      await ctx.reply("❌ Este código já foi utilizado.");
      return;
    }

    // Buscar o usuário
    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('telegram_id', ctx.from.id)
      .single();

    if (userError || !usuario) {
      await ctx.reply("❌ Erro ao acessar seu perfil. Por favor, tente novamente.");
      return;
    }

    const novoSaldo = (usuario.saldo || 0) + gift.valor;

    // Atualizar saldo do usuário
    const { error: updateError } = await supabase
      .from('usuarios')
      .update({ saldo: novoSaldo })
      .eq('telegram_id', ctx.from.id);

    if (updateError) {
      console.error("Erro ao atualizar saldo:", updateError);
      await ctx.reply("❌ Erro ao atualizar saldo. Por favor, tente novamente.");
      return;
    }

    // Marcar gift como usado
    const { error: giftUpdateError } = await supabase
      .from('gifts')
      .update({ usado: true })
      .eq('id', gift.id);

    if (giftUpdateError) {
      console.error("Erro ao atualizar gift:", giftUpdateError);
      // Não vamos interromper o processo aqui, pois o saldo já foi atualizado
    }

    // Registrar a transação
    const { error: transactionError } = await supabase
      .from('transacoes')
      .insert({
        usuario_id: usuario.id,
        tipo: 'gift',
        valor: gift.valor,
        data_compra: new Date().toISOString()
      });

    if (transactionError) {
      console.error("Erro ao registrar transação:", transactionError);
      // Não vamos interromper o processo aqui, pois o saldo já foi atualizado
    }

    await ctx.reply(`
🎉 Gift Resgatado com Sucesso! 🎉

💰 Valor: ${formatarMoeda(gift.valor)}
💼 Novo Saldo: ${formatarMoeda(novoSaldo)}

Aproveite seus créditos!
    `);

  } catch (error) {
    console.error("Erro ao resgatar gift:", error);
    await ctx.reply("❌ Erro ao resgatar gift. Por favor, tente novamente ou contate o suporte.");
  }
});
// Rotas Express
app.post('/webhook-pix', async (req, res) => {
  try {
    const { userId, valor, status } = req.body;
    
    if (status === 'paid') {
      const usuario = await buscarUsuario(userId);
      const novoSaldo = (usuario?.saldo || 0) + valor;
      await atualizarSaldoUsuario(userId, novoSaldo);
      
      await bot.telegram.sendMessage(userId, `✅ Recarga de ${formatarMoeda(valor)} confirmada!\nNovo saldo: ${formatarMoeda(novoSaldo)}`);
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: 'Erro interno no webhook' });
  }
});

// Iniciar Bot e Servidor
Promise.all([
  bot.launch(),
  new Promise((resolve) => {
    app.listen(3001, () => {
      console.log('🌐 Servidor Express rodando na porta 3001');
      resolve();
    });
  })
])
.then(() => console.log('🤖 Bot e servidor iniciados com sucesso!'))
.catch(err => {
  console.error('❌ Erro ao iniciar:', err);
  process.exit(1);
});

// Tratamento de erros globais
bot.catch((err, ctx) => {
  console.error(`❌ Erro não tratado: ${err}`);
  ctx.reply("⚠️ Ocorreu um erro inesperado. Tente novamente!");
});



// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));