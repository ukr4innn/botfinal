import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PAGHIPER_API_KEY = "apk_48143341-HhdZVplVnNzegwLgAQFOwCMreuflNroQ"; // 🔹 Insira a chave API do PagHiper

app.post('/gerar-pix', async (req, res) => {
  try {
    const { valor, order_id, payer_email, payer_name, payer_cpf_cnpj, payer_phone } = req.body;
    if (!valor || !order_id || !payer_email || !payer_name || !payer_cpf_cnpj || !payer_phone) {
      return res.status(400).json({ error: "Dados obrigatórios não informados" });
    }

    const amountCents = Math.round(parseFloat(valor) * 100);

    const payload = {
      apiKey: PAGHIPER_API_KEY,
      order_id,
      payer_email,
      payer_name,
      payer_cpf_cnpj,
      payer_phone,
      days_due_date: 3,
      notification_url: "https://seusite.com/notificacao",
      discount_cents: 0,
      shipping_price_cents: 0,
      shipping_methods: "SEDEX",
      fixed_description: true,
      seller_description: "Compra de Produto X",
      items: [
        {
          item_id: "001",
          description: "Produto Exemplo",
          quantity: 1,
          price_cents: amountCents.toString()
        }
      ]
    };

    const response = await axios.post('https://pix.paghiper.com/invoice/create/', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error("Erro ao gerar PIX:", error.response ? error.response.data : error.message);
    res.status(500).json({ error: "Erro ao gerar PIX" });
  }
});

app.get('/verificar-pagamento/:transaction_id', async (req, res) => {
  const { transaction_id } = req.params;

  try {
    const response = await axios.post('https://pix.paghiper.com/invoice/status/', {
      apiKey: PAGHIPER_API_KEY,
      transaction_id
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const status = response.data.status === "paid" ? "paid" : "pending";
    res.json({ status });
  } catch (error) {
    console.error("Erro ao verificar status do pagamento:", error.response ? error.response.data : error.message);
    res.status(500).json({ error: "Erro ao verificar status do pagamento" });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🌐 Servidor Express rodando na porta ${PORT}`);
});
