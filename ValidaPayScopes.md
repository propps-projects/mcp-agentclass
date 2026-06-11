# ValidaPay API — Documentação de Rotas e Integrações

> Documento gerado automaticamente a partir da coleção Postman oficial da ValidaPay.
> Destinado ao consumo por IAs, desenvolvedores e integradores.

---

## Visão Geral

A **ValidaPay** é uma plataforma de pagamentos brasileira que oferece:

- **PIX** — cobranças instantâneas com QR Code estático e dinâmico
- **Boleto bancário** — emissão de boletos com vencimento, juros e desconto
- **Cartão de crédito** — tokenização e cobrança via checkout transparente
- **Assinaturas** — recorrência com suporte a upgrade/downgrade e pro-rata
- **Checkouts** — sessões de pagamento hospedadas pela ValidaPay
- **Split de pagamentos** — divisão automática de receita entre subcontas
- **Subcontas** — onboarding e gestão de sub-merchants (marketplace)
- **Cupons** — descontos aplicáveis a cobranças e assinaturas
- **Saques e extratos** — movimentação financeira da carteira digital
- **Devoluções** — estorno total ou parcial de cobranças PIX

---

## Autenticação

Todas as rotas protegidas exigem o header:

```
Authorization: Bearer {{token}}
```

### Obter Token OAuth2

```
POST {{auth_url}}/auth/token
Content-Type: application/x-www-form-urlencoded
```

**Body (form-urlencoded):**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `grant_type` | string | Sempre `client_credentials` |
| `client_id` | string | ID do cliente OAuth2 (`{{client_id}}`) |
| `client_secret` | string | Segredo do cliente (`{{client_secret}}`) |
| `scope` | string | Escopos solicitados (ver lista abaixo) |

**Escopos disponíveis:**

```
pix.cob/read          pix.cob/write
wallet/read           wallet/write
products/read         products/write
proposals/read        proposals/write
subscriptions/read    subscriptions/write
checkouts/read        checkouts/write
customers/read        customers/write
subaccounts/read
```

> **Variáveis de ambiente esperadas:** `{{base_url}}`, `{{auth_url}}`, `{{client_id}}`, `{{client_secret}}`, `{{scope}}`, `{{token}}`

---

## Formato de Erros

Todos os erros seguem o padrão:

```json
{
  "error": {
    "message": "Descrição legível do erro",
    "code": "ERROR_CODE_ENUM",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

| Código HTTP | Significado |
|-------------|-------------|
| `400` | Dados inválidos na requisição |
| `401` | Token ausente, expirado ou inválido |
| `403` | Sem permissão / escopo insuficiente |
| `404` | Recurso não encontrado |
| `409` | Conflito de estado (ex.: cobrança já paga) |
| `500` | Erro interno do servidor |

---

## PIX

Cobranças via PIX usando QR Code dinâmico. O `emv` retornado é o payload do QR Code que o cliente usa para pagar. O `expiration` define em segundos por quanto tempo o QR Code é válido.

**Ciclo de status:** `PENDING` → `PAID` → (`CANCELED` | `ARCHIVED` | `REFUNDED` | `PARTIALLY_REFUNDED`)

### Status de cobrança

```
GET {{base_url}}/v1/charges/:chargeId
```

**Escopo necessário:** `pix.cob/read`

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:chargeId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
    "chargeId": "cha_1771453171013_fp6iocaxb",
    "status": "PAID",
    "amount": 0.2,
    "paymentType": "PIX",
    "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/bfc2182e025f97f17f843ae1fe8a895204000053039865802BR5909ValidaPix6013Florianopolis62070503***63049C4E",
    "paidAt": "2026-02-18T22:22:50.031Z",
    "createdAt": "2026-02-18T22:19:31.013Z",
}
```

</details>

<details>
<summary><code>200</code> — 200 — PENDING</summary>

```json
{
  "chargeId": "cha_1771453171013_fp6iocaxb",
  "status": "PENDING",
  "amount": 10.0,
  "paymentType": "PIX",
  "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/example5204000053039865802BR5909ValidaPix6013Florianopolis62070503***6304ABCD",
  "createdAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>200</code> — 200 — CANCELED</summary>

```json
{
  "chargeId": "cha_1771453171013_fp6iocaxb",
  "status": "CANCELED",
  "amount": 10.0,
  "paymentType": "PIX",
  "canceledAt": "2026-06-10T10:05:00.000Z",
  "createdAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Cobrança não encontrada</summary>

```json
{
  "error": {
    "message": "Cobrança cha_xxx não encontrada",
    "code": "CHARGE_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Cancelar cobrança

```
DELETE {{base_url}}/v1/charges/:chargeId
```

**Escopo necessário:** `pix.cob/write`

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:chargeId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "message": "Cobrança cancelada com sucesso",
  "chargeId": "cha_1779239661689_g1ugeix0e"
}
```

</details>

<details>
<summary><code>400</code> — 400 — Cobrança já paga</summary>

```json
{
  "error": {
    "message": "Não é possível cancelar uma cobrança com status PAID",
    "code": "CHARGE_ALREADY_PAID",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>

<details>
<summary><code>404</code> — 404 — Não encontrada</summary>

```json
{
  "error": {
    "message": "Cobrança cha_xxx não encontrada",
    "code": "CHARGE_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Arquivar cobrança

```
POST {{base_url}}/v1/charges/:chargeId/archive
```

**Escopo necessário:** `pix.cob/write`

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:chargeId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "chargeId": "cha_1779238435235_iaw4pcprl",
  "status": "ARCHIVED",
  "archivedAt": "2026-05-23T13:06:09.693Z"
}
```

</details>


### Cobrança imediata

```
POST {{base_url}}/v1/charges/pix
```

**Escopo necessário:** `pix.cob/write`

Com esta funcionalidade você pode criar um QR Code de cobrança imediata.

**Case de uso:**

_Como SaaS, quero gerar cobranças preenchendo apenas o valor do produto e nada mais_

**Body (JSON):**

```json
{
  "amount": 10.0,
  "expiration": 3600,
  "customer": {
    "name": "Isaac Newton",
    "documentNumber": "12345678920",
    "email": "isaac@example.com",
    "phone": "11975896541"
  },
  "metadata": {
    "externalId": "pedido-123"
  },
  "webhookUrl": "https://api.seusite.com.br/webhook"
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
    "chargeId": cha_1771511282731_9p1wo3tql,
    "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/77e66fbad26b0b294eeb56c7c7c29f5204000053039865802BR5909ValidaPix6013Florianopolis62070503***6304BA13"
}
```

</details>

<details>
<summary><code>400</code> — 400 — Valor inválido</summary>

```json
{
  "error": {
    "message": "O campo amount deve ser maior que zero",
    "code": "INVALID_AMOUNT",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>

<details>
<summary><code>401</code> — 401 — Token inválido</summary>

```json
{
  "error": {
    "message": "Token de autenticação inválido ou expirado",
    "code": "UNAUTHORIZED",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


---

## Split de Pagamentos

Divide automaticamente o valor de uma cobrança PIX entre múltiplas subcontas. Dois tipos de split: `fixed` (valor fixo em R$) e `percentage` (percentual do valor bruto). O split é descontado do valor líquido após as taxas da ValidaPay.

### Cobrança imediata com split

```
POST {{base_url}}/v1/charges/pix
```

**Escopo necessário:** `pix.cob/write`

Com esta funcionalidade você pode criar um QR Code de cobrança na sua conta e fazer split para outras contas ValidaPay.

**Case de uso:**

_Como SaaS, tenho parceiros/afiliados PF ou PJ. Quero gerar cobranças na minha conta preenchendo apenas o valor do produto e fazer split para as contas dos meus parceiros._

**Body (JSON):**

```json
{
  "amount": 100.0,
  "split": [
    {
      "type": "fixed",
      "accountNumber": "896532569",
      "amount": 10.0
    },
    {
      "type": "percentage",
      "accountNumber": "125485692",
      "percentage": 5
    }
  ],
  "metadata": {
    "externalId": "pedido-456"
  }
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
    "chargeId": cha_1881511282731_9p1wo5plk,
    "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/77e66fbad26b0b294eeb56c7c7c29f5204000053039865802BR5909ValidaPix6013Florianopolis62070503***6304BA13"
}
```

</details>

<details>
<summary><code>400</code> — 400 — Split excede valor líquido</summary>

```json
{
  "error": {
    "message": "O valor total do split não pode exceder o valor líquido da cobrança",
    "code": "SPLIT_AMOUNT_EXCEEDED",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Split para Conta Master

```
POST {{base_url}}/v1/charges/pix
```

**Escopo necessário:** `pix.cob/write`

Com esta funcionalidade você pode criar um QR Code de cobrança na conta de um _Seller_ e fazer split para a sua conta.

**Case de uso:**

_Como SaaS tenho vários Sellers, cada um deles possui uma subconta ValidaPay. Quero gerar cobranças para qualquer subconta preenchendo apenas o valor do produto e fazer split para a minha conta Master_

> ⚠️ **Atenção:** O número da subconta é retornado via webhook quando a subconta é aprovada.

**Headers opcionais:**

| Header | Valor | Descrição |
|--------|-------|-----------|
| `X-Sub-Account` | `{{subaccount_number}}` |   [REQUIRED] Subconta da cobrança |

**Body (JSON):**

```json
{
  "amount": 1.0,
  "split": [
    {
      "type": "fixed",
      "amount": 0.1
    }
  ]
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
    "chargeId": cha_15631511282731_9p1wo5ghu,
    "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/77e66fbad26b0b294eeb56c7c7c29f5204000053039865802BR5909ValidaPix6013Florianopolis62070503***6304BA13"
}
```

</details>


### Status de cobrança com split

```
GET {{base_url}}/v1/charges/:chargeId
```

**Escopo necessário:** `pix.cob/read`

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:chargeId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
    "chargeId": "cha_1771453171013_fp6iocaxb",
    "status": "PAID",
    "amount": 0.2,
    "paymentType": "PIX",
    "masterAccointId": "2345567893",
    "subaccountId": "987654322",
    "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/bfc2182e025f97f17f843ae1fe8a895204000053039865802BR5909ValidaPix6013Florianopolis62070503***63049C4E",
    "paidAt": "2026-02-18T22:22:50.031Z",
    "createdAt": "2026-02-18T22:19:31.013Z",
}
```

</details>


---

## Subcontas (Marketplace)

Gerencia sub-merchants dentro de um marketplace ValidaPay. O fluxo é: (1) criar proposta de onboarding, (2) acompanhar status via `formId`, (3) listar subcontas aprovadas. Documentos CPF (11 dígitos) criam conta PF; CNPJ (14 dígitos) criam conta PJ.

### Criar subconta PF

```
POST {{base_url}}/v1/proposals
```

**Escopo necessário:** `proposals/write`

Com esta funcionalidade você pode criar subcontas Pessoa Física na ValidaPay. Ao criar a subconta ela ficará associada à sua conta (chamaremos de conta Master).

Case de uso:

_Como SaaS tenho vários Sellers, preciso gerar cobranças para esses Sellers e receber split em cada venda._

> ⚠️ **Atenção:** Não é possivel criar uma subconta com mesmo email e telefone da _master account._ 
  
> ⚠️ **Atenção:** Dados de renda/faturamento no campo financialDetails são obrigatórios. Os respectivos códigos estão descritos no apêndice Campos Financeiros ao final da sessão Subcontas ValidaPay

**Body (JSON):**

```json
{
  "documentNumber": "77753120093",
  "phoneNumber": "+5511912345678",
  "email": "validapay@validapay.com.br",
  "motherName": "Teste Mãe",
  "fullName": "Richard Feynman",
  "socialName": "",
  "birthDate": "31-12-2000",
  "address": {
    "postalCode": "06455030",
    "street": "Alameda Xingu",
    "number": "350",
    "addressComplement": "",
    "neighborhood": "Alphaville Industrial",
    "city": "Barueri",
    "state": "SP"
  },
  "isPoliticallyExposedPerson": false,
  "financialDetails": {
    "declaredIncome": "1DINP02",
    "occupation": "ONP07",
    "netWorth": "NWNP02"
  },
  "webhookUrl": "https://api.teste.com.br"
}
```

**Respostas:**

<details>
<summary><code>201</code> — 201</summary>

```json
{
  "status": "UNFINISHED",
  "message": "Formulário criado com sucesso",
  "formId": "a6358673-dd00-4c6d-9592-df393513a78a"
}
```

</details>

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "status": "FINISHED",
  "message": "Formulário atualizado com sucesso",
  "formId": "cda0e605-44f7-4cbc-850c-ef3a2073c685"
}
```

</details>


### Criar subconta PJ

```
POST {{base_url}}/v1/proposals
```

**Escopo necessário:** `proposals/write`

Com esta funcionalidade você pode criar subcontas Pessoa Jurídica na ValidaPay. Ao criar a subconta ela ficará associada à sua conta (chamaremos de conta Master).

Case de uso:

_Como SaaS tenho vários Sellers, preciso gerar cobranças para esses Sellers e receber split em cada venda._

> ⚠️ **Atenção:** Não é possivel criar uma subconta com mesmo email e telefone da _master account_ 
  
> ⚠️ **Atenção:** Dados de renda/faturamento no campo financialDetails são obrigatórios. Os respectivos códigos estão descritos no apêndice Campos Financeiros ao final da sessão Subcontas ValidaPay

**Body (JSON):**

```json
{
  "contactNumber": "+5511912345678",
  "documentNumber": "87649940000194",
  "businessEmail": "validapay@validapay.com.br",
  "businessName": "VaplidaPay",
  "tradingName": "validaPay LTDA",
  "companyType": "PJ",
  "owner": [
    {
      "ownerType": "SOCIO",
      "documentNumber": "72352781027",
      "fullName": "Cesar Lattes ",
      "phoneNumber": "+5511912345128",
      "email": "sociokyc@celcoin.com.br",
      "motherName": "Marie Curie",
      "socialName": "Nome",
      "birthDate": "02-02-1990",
      "address": {
        "postalCode": "06455030",
        "street": "Alameda Xingu",
        "number": "50",
        "addressComplement": "",
        "neighborhood": "Alphaville Industrial",
        "city": "Barueri",
        "state": "SP"
      },
      "isPoliticallyExposedPerson": false,
      "financialOwnerDetails": {
        "ownerDeclaredIncome": "ODIB02",
        "ownerDeclaredRevenue": "ODRB02"
      }
    }
  ],
  "businessAddress": {
    "postalCode": "06455030",
    "street": "Alamed Xingu",
    "number": "350",
    "addressComplement": "",
    "neighborhood": "Alphaville Industrial",
    "city": "Barueri",
    "state": "SP"
  },
  "webhookUrl": "https://api.teste.com.br"
}
```

**Respostas:**

<details>
<summary><code>201</code> — 201</summary>

```json
{
  "status": "UNFINISHED",
  "message": "Formulário criado com sucesso",
  "formId": "fb8cbb9d-d376-4604-940c-957e76e3dcbb"
}
```

</details>

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "status": "FINISHED",
  "message": "Formulário criado com sucesso",
  "formId": "8f82a068-ff1a-45b7-8f98-71f07176e0dd"
}
```

</details>


### Status de subconta

```
GET {{base_url}}/v1/proposals/:formId
```

**Escopo necessário:** `proposals/write`

Quando a conta for aprovada, será enviado um evento na URL de webhook cadastrada nas rotas de criação de conta PF e PJ. O evento segue o seguinte layout:

``` json
{
  "event": "account_approved",
  "status": "CONFIRMED",
  "account": {
    "account": "123456",
    "branch": "0001",
    "documentNumber": "123456789",
    "ispb": "13935893",
    "name": "Werner Heisenberg"
  },
  "onboardingId": "fc0e6dab-8210-4f2d-8fce-2e94990b63ef",
  "documentNumber": "1234567889",
  "formId": "7b83fcb4-fe9c-4ad3-8d3a-621fe9c9ffc1",
  "createdAt": "2025-06-02T17:46:10.1120909"
}

 ```

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:formId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — PF 200</summary>

```json
{
  "phoneNumber": "+5511912345678",
  "isPoliticallyExposedPerson": false,
  "documentNumber": "82117120083",
  "motherName": "Teste Mãe",
  "fullName": "Teste teste",
  "type": "PF",
  "birthDate": "31-12-2000",
  "email": "everton.silva@validapix.tech",
  "socialName": "",
  "address": {
    "number": "12",
    "addressComplement": "",
    "city": "Barueri",
    "street": "Alameda Xingu",
    "postalCode": "",
    "neighborhood": "Alphaville Industrial",
    "state": "SP"
  },
  "metaData": {
    "formId": "a6358673-dd00-4c6d-9592-df393513a78a",
    "createdAt": "2025-11-21T21:52:49.155Z",
    "updatedAt": "2025-11-21T21:53:43.213Z"
  },
  "proposalStatus": {
    "form": "UNFINISHED",
    "proposal": "PENDING",
    "documents": "PENDING",
    "urlDocumentscopy": "https://validapay.cadastro.io/0336bdddcd087923e2d0249b4cdd268d"
  }
}
```

</details>

<details>
<summary><code>200</code> — PJ 200</summary>

```json
{
  "documentNumber": "11116404000161",
  "type": "PJ",
  "businessName": "FULANO SILVA PUBLICIDADE, PROMOCAO E PRODUCAO DE EVENTOS ESPORTIVOS LTDA",
  "tradingName": "NEY SILVA",
  "businessEmail": "sdgasgasf@gmail.com",
  "contactNumber": "+558145630249",
  "businessAddress": {
    "number": "10",
    "addressComplement": "CXPST 2",
    "city": "CHA GRANDE",
    "street": "ANTONIO",
    "postalCode": "55636000",
    "neighborhood": "CAMELA",
    "state": "PE"
  },
  "financialCompanyDetails": {
    "declaredCompanyRevenue": "DCRB02"
  },
  "owner": [
    {
      "ownerType": "SOCIO",
      "address": {
        "number": "10",
        "city": "CHA GRANDE",
        "street": "Av. Sao Jose",
        "postalCode": "55636000",
        "neighborhood": "Chã Grande",
        "state": "PE",
        "complement": ""
      },
      "financialOwnerDetails": {
        "ownerDeclaredIncome": "ODIB04"
      },
      "phoneNumber": "+558112345689",
      "isPoliticallyExposedPerson": false,
      "documentNumber": "68574699039",
      "motherName": "SELMA MARIA DA SILVA",
      "fullName": "FUNANO CRISTOVAO DA SILVA",
      "type": "PF",
      "birthDate": "30-11-1991",
      "email": "asfrgasfghafhafs@gmail.com"
    }
  ],
  "proposalId": "d0c39afa-d034-4330-8d57-527eacca88c6",
  "metaData": {
    "formId": "31aa2217-a149-40ba-847f-c23500a635c7",
    "createdAt": "2026-02-24T02:18:55.257Z",
    "updatedAt": "2026-02-24T02:29:04.911Z",
    "origin": "API"
  },
  "proposalStatus": {
    "fo
// ... (truncado)
```

</details>


### Listar subcontas

```
GET {{base_url}}/v1/accounts/subaccounts?dateFrom=2026-02-01T00:00:00.000Z&dateTo=2026-02-23T23:59:59.999Z&page=1&perPage=15
```

**Escopo necessário:** `subaccounts/read`

Com esta rota você poderá listar todas as subcontas associadas à sua _master account_

**Query params:**

| Parâmetro | Exemplo | Obrigatório | Descrição |
|-----------|---------|-------------|-----------|
| `dateFrom` | `2026-02-01T00:00:00.000Z` | sim |  |
| `dateTo` | `2026-02-23T23:59:59.999Z` | sim |  |
| `page` | `1` | sim |  |
| `perPage` | `15` | sim |  |

**Body (JSON):**

```json
{
  "amount": 1.0,
  "split": [
    {
      "type": "fixed",
      "amount": 0.1
    }
  ]
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "masterAccountId": "SANDBOX_0438f4c8-0031-7051-16d4-5a23704756b6",
  "subAccounts": [
    {
      "documentNumber": "96707067001",
      "createdAt": "2026-02-23T22:29:52.537Z",
      "accountNumber": "4960589",
      "status": "CONFIRMED",
      "onboardingId": "b9790268-a770-4aec-8fe5-d891f17e8007",
      "name": "Friedrich Nietzsche",
      "dailyWithdrawalLimit": 3000,
      "balance": 0
    },
    {
      "documentNumber": "14282497700",
      "createdAt": "2026-02-17T20:38:45.664Z",
      "accountNumber": "4949228",
      "status": "CONFIRMED",
      "onboardingId": "30608b18-7258-437d-a6cb-63e5882e4fb7",
      "name": "Tales de Mileto",
      "dailyWithdrawalLimit": 3000,
      "balance": 170.9
    }
  ],
  "page": 1,
  "perPage": 15,
  "hasMore": false,
  "dateFrom": "2026-02-01T00:00:00.000Z",
  "dateTo": "2026-02-23T23:59:59.999Z"
}
```

</details>


### Listar cobranças

```
GET {{base_url}}/v1/charges?dateFrom=2026-02-01T00:00:00.000Z&dateTo=2026-02-23T23:59:59.999Z&page=1&perPage=15
```

**Escopo necessário:** `subaccounts/read`

Com esta rota você poderá listar todas as cobranças que a sua _master account_ gerou em uma subcontas

**Headers opcionais:**

| Header | Valor | Descrição |
|--------|-------|-----------|
| `X-Sub-Account` | `{{subaccount_number}}` |   [REQUIRED] Subconta da qual você quer listar as cobranças |

**Query params:**

| Parâmetro | Exemplo | Obrigatório | Descrição |
|-----------|---------|-------------|-----------|
| `dateFrom` | `2026-02-01T00:00:00.000Z` | sim |  |
| `dateTo` | `2026-02-23T23:59:59.999Z` | sim |  |
| `page` | `1` | sim |  |
| `perPage` | `15` | sim |  |

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "data": [
    {
      "status": "PENDING",
      "createdAt": "2026-02-23T18:46:22.652Z",
      "chargeId": "cha_1771872382645_qe5j0ohge",
      "updatedAt": "2026-02-23T18:46:22.652Z",
      "masterAccountId": "SANDBOX_0438f4c8-0031-7051-16d4-5a23704756b6",
      "amount": 39.9,
      "provider": "CELCOIN",
      "attempts": 1,
      "emvQrCode": "00020101021226930014br.gov.bcb.pix2571qrcode-h.pix.celcoin.com.br/pixqrcode/v2/b3e3ff8fc93f7c11aa1dfae0a1d29b5204000053039865802BR5909ValidaPix6013Florianopolis62070503***630433A1",
      "paymentType": "PIX",
      "subAccountId": "4949228"
    },
    {
      "status": "PENDING",
      "createdAt": "2026-02-23T18:34:13.130Z",
      "chargeId": "cha_1771871653130_pzzsyzeha",
      "updatedAt": "2026-02-23T18:34:13.130Z",
      "masterAccountId": "SANDBOX_0438f4c8-0031-7051-16d4-5a23704756b6",
      "amount": 39.9,
      "provider": "CELCOIN",
      "attempts": 1,
      "emvQrCode": "00020101021226930014br.gov.bcb.pix2571qrcode-h.pix.celcoin.com.br/pixqrcode/v2/95f41bdeede9f0be5c23f438ec42935204000053039865802BR5909ValidaPix6013Florianopolis62070503***630426DB",
      "paymentType": "PIX",
      "subAccountId": "4949228"
    },
    {
      "status": "PENDING",
      "createdAt": "2026-02-23T18:34:09.892Z",
      "chargeId": "cha_1771871649852_mm0luemzr",
      "updatedAt": "2026-02-23T18:34:09.892Z",
      "masterAccountId": "SANDBOX_0438f4c8-0031-7051-16d4-5a23704756b6",
      "amount": 39.9,
      "provider": "CELCOIN",
      
// ... (truncado)
```

</details>


### Saldo subcontas

```
GET {{base_url}}/v1/wallet/balance?accountId=9489623
```

**Escopo necessário:** `wallet/read`

Com esta funcionalidade você pode verificar o saldo de uma ou várias subcontas

> ⚠️ **Atenção:** Para consultar o saldo de várias subcontas envie o header acoountId com o número das subcontas separado por vírgula, por exemplo: 9489623,9489624,9489625

**Query params:**

| Parâmetro | Exemplo | Obrigatório | Descrição |
|-----------|---------|-------------|-----------|
| `accountId` | `9489623` | sim | [REQUIRED] Número da subconta. Para consultar o saldo de várias subcontas envie separado por virgula |

**Respostas:**

<details>
<summary><code>200</code> — Sucesso</summary>

```json
{
  "masterAccountId": "429131313",
  "balances": [
    {
      "accountNumber": "459013888",
      "name": "VALIDAPAY PAGAMENTOS TECNOLOGIA E SERVICOS",
      "balance": 54.81
    },
    {
      "accountNumber": "460851986",
      "name": "VALIDA PIX",
      "balance": 196.82
    }
  ]
}
```

</details>

<details>
<summary><code>401</code> — Acesso negado</summary>

```json
{
  "error": {
    "message": "Subconta 436514888 nao pertence a esta conta master",
    "code": "UNAUTHORIZED_SUBACCOUNT",
    "details": null,
    "timestamp": "2026-03-17T03:45:53.738Z"
  }
}
```

</details>

<details>
<summary><code>404</code> — Subconta não encontrada</summary>

```json
{
  "error": {
    "message": "Subconta 459013666 nao encontrada",
    "code": "SUBACCOUNT_NOT_FOUND",
    "details": null,
    "timestamp": "2026-03-17T03:46:49.577Z"
  }
}
```

</details>


---

## Checkout Transparente e Hospedado

Dois modelos de checkout: **Transparente** (`POST /v1/charges`) integra diretamente na sua UI passando os dados de pagamento; **Checkout Session** (`POST /v1/checkouts/session`) gera uma URL hospedada pela ValidaPay onde o cliente finaliza o pagamento.

### Checkout Transparente

```
POST {{base_url}}/v1/charges
```

**Escopo necessário:** `checkouts/write`

Você envia os dados do cliente, método de pagamento e itens diretamente pela API, sem redirecionar o usuário para uma página externa. Toda a experiência de compra acontece na sua própria interface (site, app, sistema) e envia os dados de pagamento para a ValidaPay.

Métodos de pagamento suportados: `creditcard`, `pix`, `boleto`

Os itens do pedido referenciam preços (`priceId`) previamente cadastrados via rota de produtos. Para pagamentos com cartão de crédito, os dados do cartão devem ser enviados no objeto `card`.

**Campos exclusivos por método:**

| Campo | creditcard | pix | boleto |
|---|---|---|---|
| `card` | obrigatório | — | — |
| `installments` | opcional (1–12) | — | — |
| `dueDate` (YYYY-MM-DD) | — | opcional | opcional |
| `expiration` (YYYY-MM-DD) | — | opcional | — |
| `expirationAfterDueDate` | — | — | opcional (0–60 dias) |
| `boletoInstructions` | — | — | opcional |

> ⚠️ **`dueDate`**: se omitido para pix/boleto, o sistema usa 30 dias a partir de hoje.  
> ⚠️ **`expiration`**: vencimento final do PIX COBV; se omitido, deriva de `dueDate + 30 dias`.

Case de uso:

_Como SaaS, quero oferecer assinaturas com pagamento por cartão de crédito diretamente no meu app, sem redirecionar o usuário para outra página. Cadastro meus planos como produtos, e na hora do pagamento envio o priceId do plano escolhido junto com os dados do cartão._

_Como e-commerce, quero oferecer PIX e boleto como opções de pagamento no meu próprio checkout customizado. Monto o carrinho com os priceId dos produtos, coleto os dados do cliente e processo tudo numa única chamada._

**Body (JSON):**

```json
{
  "paymentMethod": "creditcard",
  "installments": 5,
  "passFeesToCustomer": true,
  "freeInstallments": 0,
  "dueDate": "2026-07-31",
  "expiration": "2026-08-30",
  "expirationAfterDueDate": 30,
  "boletoInstructions": {
    "fine": 2,
    "interest": 1,
    "discount": {
      "amount": 5,
      "modality": "fixed",
      "limitDate": "2026-07-30"
    }
  },
  "customer": {
    "name": "Isaac Newton",
    "email": "isaac.newton@validapay.com.br",
    "documentNumber": "12345678920",
    "phone": "11975896541",
    "address": {
      "type": "BILLING",
      "street": "Rua das Flores",
      "number": "123",
      "complement": "Apto 45",
      "neighborhood": "Centro",
      "city": "Florianópolis",
      "state": "SC",
      "zipCode": "88010000",
      "country": "BR",
      "cityCode": "4205407"
    }
  },
  "card": {
    "number": "5230552482605921",
    "cvv": "100",
    "name": "Issac Newton",
    "expiration": "12/2030"
  },
  "items": [
    {
      "priceId": "price_1769679249534_3hhtbkmkj",
      "quantity": 1
    }
  ],
  "metadata": {
    "source": "website"
  }
}
```

**Respostas:**

<details>
<summary><code>404</code> — 404</summary>

```json
{
  "error": {
    "message": "Price price_1769550554939_2litgla99 não encontrado",
    "code": "PRICE_NOT_FOUND",
    "details": null,
    "timestamp": "2026-01-28T11:10:54.750Z"
  }
}
```

</details>

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "success": true,
  "customerId": "cus_1772230075378_21n6ykyb9",
  "paymentId": "sandbox_card_17723961707554498"
}
```

</details>

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "success": true,
  "customerId": "cus_1772230075378_21n6ykyb9",
  "chargeId": "cha_1772398220843_9ovrhe4po",
  "pix": {
    "emv": "00020126330014br.gov.bcb.pix01110000000000052040000530398654089.905802BR5925VALIDAPAY SANDBOX6014SAO PAULO62070503***63044BDX"
  }
}
```

</details>

<details>
<summary><code>200</code> — 200 — Boleto</summary>

```json
{
  "chargeId": "cha_1780000000001_xyz789",
  "digitableLine": "03399.00000 00000.000000 00000.000000 1 00000000025000",
  "barCode": "03391000000000000000000000000000100000002500000",
  "dueDate": "2026-07-31",
  "pdfUrl": "/v1/charges/cha_1780000000001_xyz789/boleto.pdf"
}
```

</details>


### Criar Produto

```
POST {{base_url}}/v1/products
```

**Escopo necessário:** `products/write`

Cria um novo produto vinculado a sua conta. Os produtos criados ficam disponíveis no painel administrativo e podem ser utilizados tanto no checkout transparente (via API) quanto no checkout pro (link de pagamento). Ao criar um produto, voce pode associar um ou mais preços (prices), incluindo configurações de recorrência para cobranças periódicas, conforme abaixo:

- ONE_TIME → "Avulsa"
    
- MONTHLY → "Mensal"
    
- WEEKLY → "Semanal"
    
- QUARTERLY → "Trimestral"
    
- YEARLY → "Anual"
    

Case de uso:

_Como SaaS, quero cadastrar meus planos (ex: Básico, Pro, Enterprise) como produtos com preços recorrentes, para que meus clientes possam assinar diretamente pelo checkout pro ou pela minha própria interface integrada via checkout transparente._

_Como marketplace, quero cadastrar os servicos oferecidos como produtos avulsos com preço fixo, para gerar cobranças pontuais aos compradores_

**Body (JSON):**

```json
{
  "name": "SESSION TESTE 7",
  "description": "Teste avulso",
  "statementDescriptor": "VALIDAPAY TESTE",
  "metadata": {
    "externalId": "plan_abc123"
  },
  "prices": [
    {
      "title": "Avulso Preço Normal",
      "recurrenceType": "ONE_TIME",
      "description": "Avulso",
      "amount": 100
    },
    {
      "title": "Avulso Black Friday",
      "recurrenceType": "ONE_TIME",
      "description": "Avulso preço promocional",
      "amount": 89.9
    }
  ]
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "productId": "prod_1772275462312_lsopu8ntr",
  "name": "Plano Pro 3",
  "description": "Acesso completo à plataforma",
  "type": "RECURRING",
  "billingPeriod": "MONTHLY",
  "currency": "BRL",
  "status": "active",
  "emitirNf": false,
  "metadata": {
    "externalId": "plan_abc123"
  },
  "statementDescriptor": "VALIDAPAY TESTE",
  "createdAt": "2026-02-28T10:44:22.312Z",
  "updatedAt": "2026-02-28T10:44:22.312Z",
  "prices": [
    {
      "priceId": "price_1772275462439_ztt2gcewl",
      "productId": "prod_1772275462312_lsopu8ntr",
      "title": "Mensal",
      "description": "Cobrança mensal",
      "amount": 400,
      "recurrenceType": "MONTHLY",
      "recurrenceInterval": 1,
      "trialDays": 7,
      "isActive": true,
      "discounts": [],
      "statementDescriptor": "Mensal"
    }
  ]
}
```

</details>


### Listar produtos

```
GET {{base_url}}/v1/products
```

**Escopo necessário:** `products/read`

Liste todos os produtos criados

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
[
  {
    "updatedAt": "2026-02-28T10:44:22.312Z",
    "name": "Plano Pro 3",
    "billingPeriod": "MONTHLY",
    "productId": "prod_1772275462312_lsopu8ntr",
    "status": "active",
    "emitirNf": false,
    "currency": "BRL",
    "statementDescriptor": "VALIDAPAY TESTE",
    "description": "Acesso completo à plataforma",
    "type": "RECURRING",
    "accountId": "SANDBOX_e4286468-4031-70c9-91e4-d3f5b3ac69af",
    "createdAt": "2026-02-28T10:44:22.312Z",
    "metadata": {
      "externalId": "plan_abc123"
    },
    "prices": [
      {
        "description": "Cobrança mensal",
        "fiscal": null,
        "updatedAt": "2026-02-28T10:44:22.439Z",
        "accountNumber": "SANDBOX_e4286468-4031-70c9-91e4-d3f5b3ac69af",
        "isActive": true,
        "discounts": [],
        "trialDays": 7,
        "currency": "BRL",
        "recurrenceInterval": 1,
        "title": "Mensal",
        "position": null,
        "priceSchedule": null,
        "recurrenceType": "MONTHLY",
        "priceId": "price_1772275462439_ztt2gcewl",
        "productId": "prod_1772275462312_lsopu8ntr",
        "amount": 400,
        "statementDescriptor": "Mensal",
        "createdAt": "2026-02-28T10:44:22.439Z",
        "hasSales": false
      }
    ]
  },
  {
    "productId": "prod_1772229816024_r0d93gdib",
    "createdAt": "2026-02-27T22:03:36.024Z",
    "billingPeriod": "MONTHLY",
    "status": "active",
    "emitirNf": false,
    "currency": "BRL",
    "updatedAt": "2026-02-27T22:03:36.024Z",
    
// ... (truncado)
```

</details>


### Checkout Session

```
POST {{base_url}}/v1/checkouts/session
```

**Escopo necessário:** `checkouts/write`

Esta rota cria uma sessão de pagamento e retorna um link para a página de pagamento hospedada pela ValidaPay. Ao compartilhar ou redirecionar o cliente para esse link, ele será direcionado a uma interface segura onde poderá concluir o pagamento.

Para criar uma sessão, informe o priceId de um preço previamente cadastrado. Opcionalmente, você pode enviar os dados do cliente (customer) e restringir os métodos de pagamento aceitos (allowedPaymentMethods).

A resposta inclui o id da sessao e uma url de pagamento que pode ser utilizada como fallback ou redirecionamento.

Metodos de pagamento suportados: creditcard, pix, boleto

> ⚠️ **Atenção:** Uma sessao de checkout so pode ser paga uma unica vez. Apos o pagamento bem-sucedido, a sessao e marcada como completed e novas tentativas de pagamento não serão possíveis. 
  

Case de uso:

_Como SaaS, quero gerar um link de pagamento exclusivo para cada cliente no momento da contratacao do plano. Crio uma sessao com o priceId do plano escolhido e redireciono o cliente para a URL retornada. Apos o pagamento, a sessao e encerrada automaticamente, garantindo que o mesmo link nao seja utilizado novamente._

_Como plataforma de servicos, quero enviar um link de pagamento por email ou WhatsApp para cada orçamento aprovado. Cada sessao corresponde a um pagamento unico, evitando cobranças duplicadas._

**Body (JSON):**

```json
{
  "priceId": "price_1772389525023_dd9gsj4uw",
  "allowedPaymentMethods": [
    "pix",
    "creditcard"
  ],
  "customer": {
    "email": "teste@validapay.com.com",
    "documentNumber": "00900790270"
  }
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "id": "SANDBOX_cs_1772391984588_r4lzc2h8w",
  "url": "https://app.validapay.com.br/pagamento/SANDBOX_cs_1772391984588_r4lzc2h8w",
  "priceId": "price_1772391951373_rfu2y02g1"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Price não encontrado</summary>

```json
{
  "error": {
    "message": "Price price_xxxx não encontrado",
    "code": "PRICE_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


---

## Produtos e Preços

Um **Produto** representa um serviço ou plano (ex.: "Plano Pro"). Cada produto tem um ou mais **Preços** (`prices`), que definem o valor e a recorrência. Os preços são usados para criar assinaturas. Um produto pode ser arquivado (oculto) sem ser deletado.

### Buscar produto

```
GET {{base_url}}/v1/products/:productId
```

**Escopo necessário:** `products/read`

Retorna os detalhes completos de um produto, incluindo todos os preços vinculados.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:productId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Produto encontrado</summary>

```json
{
  "productId": "prod_1772275462312_lsopu8ntr",
  "name": "Plano Pro",
  "description": "Acesso completo à plataforma",
  "type": "RECURRING",
  "status": "active",
  "currency": "BRL",
  "statementDescriptor": "VALIDAPAY",
  "metadata": {
    "externalId": "plan_abc123"
  },
  "createdAt": "2026-02-28T10:44:22.312Z",
  "updatedAt": "2026-02-28T10:44:22.312Z",
  "prices": [
    {
      "priceId": "price_1772275462439_ztt2gcewl",
      "productId": "prod_1772275462312_lsopu8ntr",
      "title": "Mensal",
      "description": "Cobrança mensal",
      "amount": 99.9,
      "recurrenceType": "MONTHLY",
      "recurrenceInterval": 1,
      "trialDays": 7,
      "isActive": true,
      "discounts": [],
      "statementDescriptor": "Mensal"
    }
  ]
}
```

</details>

<details>
<summary><code>404</code> — 404 — Produto não encontrado</summary>

```json
{
  "error": {
    "message": "Produto prod_xxxx não encontrado",
    "code": "PRODUCT_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Criar Produto

```
POST {{base_url}}/v1/products
```

**Escopo necessário:** `products/write`

Cria um novo produto vinculado a sua conta. Os produtos criados ficam disponíveis no painel administrativo e podem ser utilizados tanto no checkout transparente (via API) quanto no checkout pro (link de pagamento). Ao criar um produto, voce pode associar um ou mais preços (prices), incluindo configurações de recorrência para cobranças periódicas, conforme abaixo:

- ONE_TIME → "Avulsa"
    
- MONTHLY → "Mensal"
    
- WEEKLY → "Semanal"
    
- QUARTERLY → "Trimestral"
    
- YEARLY → "Anual"
    

Case de uso:

_Como SaaS, quero cadastrar meus planos (ex: Básico, Pro, Enterprise) como produtos com preços recorrentes, para que meus clientes possam assinar diretamente pelo checkout pro ou pela minha própria interface integrada via checkout transparente._

_Como marketplace, quero cadastrar os servicos oferecidos como produtos avulsos com preço fixo, para gerar cobranças pontuais aos compradores_

**Body (JSON):**

```json
{
  "name": "SESSION TESTE 7",
  "description": "Teste avulso",
  "statementDescriptor": "VALIDAPAY TESTE",
  "metadata": {
    "externalId": "plan_abc123"
  },
  "prices": [
    {
      "title": "Avulso Preço Normal",
      "recurrenceType": "ONE_TIME",
      "description": "Avulso",
      "amount": 100
    },
    {
      "title": "Avulso Black Friday",
      "recurrenceType": "ONE_TIME",
      "description": "Avulso preço promocional",
      "amount": 89.9
    }
  ]
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "productId": "prod_1772275462312_lsopu8ntr",
  "name": "Plano Pro 3",
  "description": "Acesso completo à plataforma",
  "type": "RECURRING",
  "billingPeriod": "MONTHLY",
  "currency": "BRL",
  "status": "active",
  "emitirNf": false,
  "metadata": {
    "externalId": "plan_abc123"
  },
  "statementDescriptor": "VALIDAPAY TESTE",
  "createdAt": "2026-02-28T10:44:22.312Z",
  "updatedAt": "2026-02-28T10:44:22.312Z",
  "prices": [
    {
      "priceId": "price_1772275462439_ztt2gcewl",
      "productId": "prod_1772275462312_lsopu8ntr",
      "title": "Mensal",
      "description": "Cobrança mensal",
      "amount": 400,
      "recurrenceType": "MONTHLY",
      "recurrenceInterval": 1,
      "trialDays": 7,
      "isActive": true,
      "discounts": [],
      "statementDescriptor": "Mensal"
    }
  ]
}
```

</details>


### Atualizar produto

```
PUT {{base_url}}/v1/products/:productId
```

**Escopo necessário:** `products/write`

Atualiza os dados de um produto existente. Para preços, inclua `priceId` para atualizar um preço existente ou omita para criar um novo preço.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:productId` | ID do recurso |

**Body (JSON):**

```json
{
  "name": "Plano Pro Atualizado",
  "description": "Acesso completo à plataforma",
  "statementDescriptor": "VALIDAPAY TESTE",
  "status": "active",
  "prices": [
    {
      "priceId": "price_xxxx",
      "title": "Mensal",
      "recurrenceType": "MONTHLY",
      "amount": 149.9,
      "trialDays": 7
    }
  ]
}
```

> **Enums:** recurrenceType: ONE_TIME | WEEKLY | MONTHLY | QUARTERLY | SEMIANNUAL | YEARLY

**Respostas:**

<details>
<summary><code>200</code> — 200 — Produto atualizado</summary>

```json
{
  "productId": "prod_1772275462312_lsopu8ntr",
  "name": "Plano Pro Atualizado",
  "status": "active",
  "updatedAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Produto não encontrado</summary>

```json
{
  "error": {
    "message": "Produto prod_xxxx não encontrado",
    "code": "PRODUCT_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Deletar produto

```
DELETE {{base_url}}/v1/products/:productId
```

**Escopo necessário:** `products/write`

Deleta um produto. Não é possível deletar produtos que possuam assinaturas ativas.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:productId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Produto deletado</summary>

```json
{
  "message": "Produto deletado com sucesso",
  "productId": "prod_1772275462312_lsopu8ntr"
}
```

</details>

<details>
<summary><code>400</code> — 400 — Assinaturas ativas</summary>

```json
{
  "error": {
    "message": "Não é possível deletar um produto com assinaturas ativas",
    "code": "PRODUCT_HAS_ACTIVE_SUBSCRIPTIONS",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>

<details>
<summary><code>404</code> — 404 — Produto não encontrado</summary>

```json
{
  "error": {
    "message": "Produto prod_xxxx não encontrado",
    "code": "PRODUCT_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Arquivar produto

```
POST {{base_url}}/v1/products/:productId/archive
```

**Escopo necessário:** `products/write`

Arquiva um produto. Produtos arquivados não ficam disponíveis para novas cobranças, mas as assinaturas e checkouts existentes continuam funcionando normalmente.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:productId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Produto arquivado</summary>

```json
{
  "productId": "prod_1772275462312_lsopu8ntr",
  "status": "archived",
  "archivedAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Produto não encontrado</summary>

```json
{
  "error": {
    "message": "Produto prod_xxxx não encontrado",
    "code": "PRODUCT_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


---

## Saques

Transferência do saldo da carteira ValidaPay para uma chave PIX. Dois modos: saque **imediato** (processa na hora) e **agendado** (define uma data futura). O saldo deve ser suficiente para cobrir o valor + tarifas.

### Saque subconta

```
POST {{base_url}}/v1/wallet/withdraw
```

**Escopo necessário:** `wallet/write`

Com esta funcionalidade você pode criar um saque em uma subconta associada à sua _master account._

> ⚠️ **Atenção:** Só é possível fazer saques para contas de mesma titularidade

**Body (JSON):**

```json
{
  "amount": 1.0,
  "pixKey": "12345678925",
  "pixKeyType": "CPF",
  "accountId": "258965356"
}
```

**Respostas:**

<details>
<summary><code>200</code> — Sucesso</summary>

```json
{
  "withdrawalId": "wdr_1772883158760_tdhomd8xe",
  "status": "PROCESSING",
  "amount": 1,
  "accountNumber": "258965356"
}
```

</details>

<details>
<summary><code>401</code> — Acesso negado</summary>

```json
{
  "error": {
    "message": "Subconta nao pertence a esta conta",
    "code": "OWNERSHIP_MISMATCH",
    "details": null,
    "timestamp": "2026-03-17T04:01:14.653Z"
  }
}
```

</details>

<details>
<summary><code>400</code> — Bloqueio por titularidade</summary>

```json
{
  "error": {
    "message": "A chave PIX nao pertence ao titular da conta",
    "code": "OWNERSHIP_MISMATCH",
    "details": null,
    "timestamp": "2026-03-17T04:01:57.811Z"
  }
}
```

</details>


### Saque master account

```
POST {{base_url}}/v1/wallet/withdraw
```

**Escopo necessário:** `wallet/write`

Com esta funcionalidade você pode criar um saque da sua _conta ValidaPay._

> ⚠️ **Atenção:** Só é possível fazer saques para contas de mesma titularidade

**Body (JSON):**

```json
{
  "amount": 1.0,
  "pixKey": "12345678925",
  "pixKeyType": "CPF"
}
```

**Respostas:**

<details>
<summary><code>200</code> — Sucesso</summary>

```json
{
  "withdrawalId": "wdr_1772883158760_tdhomd8xe",
  "status": "PROCESSING",
  "amount": 1,
  "accountNumber": "258965356"
}
```

</details>

<details>
<summary><code>400</code> — Bloqueio por titularidade</summary>

```json
{
  "error": {
    "message": "A chave PIX nao pertence ao titular da conta",
    "code": "OWNERSHIP_MISMATCH",
    "details": null,
    "timestamp": "2026-03-17T04:01:57.811Z"
  }
}
```

</details>


---

## Extratos / Transações

Consulta o histórico de movimentações financeiras da carteira. Usa paginação por cursor (`nextPageToken`). Suporta filtro por tipo de movimentação (`CREDIT`/`DEBIT`), categoria, e intervalo de datas.

### Extrato subconta

```
GET {{base_url}}/v1/wallet/transactions?accountId={{account_number}}&type=CREDIT&category=PAYMENT&dateFrom=2026-03-01T00:00:00Z&dateTo=2026-03-16T23:00:00Z&limit=5&nextPageToken=eyJTSyI6IjIwMjYtMDMtMTRUMjM6MjM6MzYuMDk2WiN0eG5fMTc3MzUzMDYxNjA5Nl8zOXdmbTk5aTQiLCJhY2NvdW50SWQiOiI0MjkxMzEyMTIifQ
```

**Escopo necessário:** `wallet/read`

Com esta funcionalidade você pode isualizar movimentações em uma subconta associada a sua _master account_

**Query params:**

| Parâmetro | Exemplo | Obrigatório | Descrição |
|-----------|---------|-------------|-----------|
| `accountId` | `{{account_number}}` | sim | required - ID da subconta a consultar |
| `type` | `CREDIT` | sim | optional — CREDIT | DEBIT |
| `category` | `PAYMENT` | sim | optional — PAYMENT | PIX_IN | PIX_OUT | WITHDRAWAL | REFUND | FEE | TRANSFER | BOLETO_IN | CARD_IN |
| `dateFrom` | `2026-03-01T00:00:00Z` | sim | optional - Data início (ISO 8601) |
| `dateTo` | `2026-03-16T23:00:00Z` | sim | optional - Data fim (ISO 8601) |
| `limit` | `5` | sim | optional - 1-100, default 50 |
| `nextPageToken` | `eyJTSyI6IjIwMjYtMDMtMTRUMjM6MjM6MzYuMDk2WiN0eG5fMTc3MzUzMDYxNjA5Nl8zOXdmbTk5aTQiLCJhY2NvdW50SWQiOiI0MjkxMzEyMTIifQ` | sim | optional - Token de paginação |

**Respostas:**

<details>
<summary><code>200</code> — Sucesso</summary>

```json
{
    "accountId": "429134563",
    "transactions": [
        {
            "transactionId": "txn_1773694940975_r10b6fyzm",
            "type": "CREDIT",
            "category": "PIX_IN",
            "amount": 2.56,
            "balanceAfter": 901.6,
            "title": "PIX recebido de Malga",
            "paymentMethod": "PIX",
            "chargeId": null,
            "subscriptionId": null,
            "endToEndId": "E13935893202603162102IfDcitXf0zO",
            "counterparty": {
                "name": "Malga",
                "bank": "13935893",
                "taxId": "37134852000458",
                "account": "410900056"
            },
            "referenceId": "E139389320260316202IfDyytXf0zO",
            "description": "PIX recebido direto",
            "createdAt": "2026-03-16T21:02:20.975Z"
        },
        {
            "transactionId": "txn_1773718528326_449bqmhm7",
            "type": "DEBIT",
            "category": "WITHDRAWAL",
            "amount": 1,
            "balanceAfter": 929.85,
            "title": "Saque PIX",
            "paymentMethod": "PIX",
            "chargeId": null,
            "subscriptionId": null,
            "endToEndId": "E13935893202563270335KF9O0GDVVIz",
            "counterparty": null,
            "referenceId": "f7d1e875-7096-4fa8-992d-0c81a09f91c0",
            "description": "Saque / transferência PIX",
            "createdAt": "2026-03-17T03:35:28.326Z"
        },
    ],
    "nextPageToken": "eyJTSyI6IjIwMjYtMDMtMTVU
// ... (truncado)
```

</details>


### Extrato conta master

```
GET {{base_url}}/v1/wallet/transactions?type=CREDIT&category=PAYMENT&dateFrom=2026-03-01T00:00:00Z&dateTo=2026-03-16T23:00:00Z&limit=5&nextPageToken=eyJTSyI6IjIwMjYtMDMtMTRUMjM6MjM6MzYuMDk2WiN0eG5fMTc3MzUzMDYxNjA5Nl8zOXdmbTk5aTQiLCJhY2NvdW50SWQiOiI0MjkxMzEyMTIifQ
```

**Escopo necessário:** `wallet/read`

Com esta funcionalidade você pode isualizar movimentações na sua conta

**Query params:**

| Parâmetro | Exemplo | Obrigatório | Descrição |
|-----------|---------|-------------|-----------|
| `type` | `CREDIT` | sim | optional — CREDIT | DEBIT |
| `category` | `PAYMENT` | sim | optional — PAYMENT | PIX_IN | PIX_OUT | WITHDRAWAL | REFUND | FEE | TRANSFER | BOLETO_IN | CARD_IN |
| `dateFrom` | `2026-03-01T00:00:00Z` | sim | optional - Data início (ISO 8601) |
| `dateTo` | `2026-03-16T23:00:00Z` | sim | optional - Data fim (ISO 8601) |
| `limit` | `5` | sim | optional - 1-100, default 50 |
| `nextPageToken` | `eyJTSyI6IjIwMjYtMDMtMTRUMjM6MjM6MzYuMDk2WiN0eG5fMTc3MzUzMDYxNjA5Nl8zOXdmbTk5aTQiLCJhY2NvdW50SWQiOiI0MjkxMzEyMTIifQ` | sim | optional - Token de paginação |

**Respostas:**

<details>
<summary><code>200</code> — Sucesso</summary>

```json
{
    "accountId": "429134563",
    "transactions": [
        {
            "transactionId": "txn_1773694940975_r10b6fyzm",
            "type": "CREDIT",
            "category": "PIX_IN",
            "amount": 2.56,
            "balanceAfter": 901.6,
            "title": "PIX recebido de Malga",
            "paymentMethod": "PIX",
            "chargeId": null,
            "subscriptionId": null,
            "endToEndId": "E13935893202603162102IfDcitXf0zO",
            "counterparty": {
                "name": "Malga",
                "bank": "13935893",
                "taxId": "37134852000458",
                "account": "410900056"
            },
            "referenceId": "E139389320260316202IfDyytXf0zO",
            "description": "PIX recebido direto",
            "createdAt": "2026-03-16T21:02:20.975Z"
        },
        {
            "transactionId": "txn_1773718528326_449bqmhm7",
            "type": "DEBIT",
            "category": "WITHDRAWAL",
            "amount": 1,
            "balanceAfter": 929.85,
            "title": "Saque PIX",
            "paymentMethod": "PIX",
            "chargeId": null,
            "subscriptionId": null,
            "endToEndId": "E13935893202563270335KF9O0GDVVIz",
            "counterparty": null,
            "referenceId": "f7d1e875-7096-4fa8-992d-0c81a09f91c0",
            "description": "Saque / transferência PIX",
            "createdAt": "2026-03-17T03:35:28.326Z"
        },
    ],
    "nextPageToken": "eyJTSyI6IjIwMjYtMDMtMTVU
// ... (truncado)
```

</details>


---

## Devoluções (Estorno PIX)

Estorno total ou parcial de cobranças PIX já pagas. O `reason` categoriza o motivo para fins de compliance. O valor do estorno não pode exceder o valor disponível para devolução.

### Devolução

```
POST {{base_url}}/v1/wallet/refunds
```

**Escopo necessário:** `wallet/write`

Com esta funcionalidade você pode criar u_ma devolução._

> ⚠️ **Atenção:** O código de motivo da devolução é obrigatório. Os códigos possiveis são:  
BANK_ERROR -> Erro bancário  
FRAUD -> Suspeita de fraude  
CUSTOMER_REQUEST -> Solicitalão do cliente  
PIX_CHANGE_ERROR -> Erro na transação

**Body (JSON):**

```json
{
  "accountId": "459013777",
  "endToEndId": "E003603052026032511186a4f4cdf139",
  "amount": 1.0,
  "reason": "CUSTOMER_REQUEST",
  "chargeId": "chg_abc123"
}
```

**Respostas:**

<details>
<summary><code>201</code> — Sucesso</summary>

```json
{
  "refundId": "ref_1774437918293_jm2hen5y7",
  "status": "PROCESSING",
  "amount": 1,
  "reason": "CUSTOMER_REQUEST",
  "endToEndId": "E003603052026032511186a4f4cdf139",
  "returnIdentification": "D13935893202603251125zbRSLI3lqPH",
  "chargeId": "cha_1774437468463_4hj927ips",
  "createdAt": "2026-03-25T11:25:18.293Z"
}
```

</details>

<details>
<summary><code>401</code> — Não autorizado</summary>

```json
{
  "error": {
    "message": "Subconta nao pertence a esta conta",
    "code": "OWNERSHIP_MISMATCH",
    "details": null,
    "timestamp": "2026-03-25T11:28:25.397Z"
  }
}
```

</details>

<details>
<summary><code>400</code> — 400 — Valor excede o original</summary>

```json
{
  "error": {
    "message": "Valor do estorno excede o valor disponível para devolução",
    "code": "REFUND_AMOUNT_EXCEEDED",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


---

## Cobrança Avulsa

Cobranças unitárias enviadas diretamente ao cliente por e-mail ou link, sem necessidade de checkout. Suporta PIX, boleto e cartão. Para boleto, o campo `dueDate` é obrigatório. Para PIX, `expiration` define o tempo de validade em segundos.

### Cobrança avulsa

```
POST {{base_url}}/v1/charges/single
```

**Escopo necessário:** `checkouts/write`

Cria uma cobrança avulsa sem necessidade de cadastrar produtos ou informar `priceId` — basta enviar o `amount`. Disponível para **Pix**, **cartão de crédito** e **boleto**.

**Campos obrigatórios:** `paymentMethod`, `amount`, `title`

Para `pix` e `boleto`, `dueDate` (YYYY-MM-DD) é recomendado; se omitido o sistema usa 30 dias.

Para `creditcard`, envie os dados do cartão no objeto `card`.

**Case de uso:**

_Como SaaS, preciso cobrar um cliente pontualmente sem criar um produto no catálogo — basta informar o valor e o método de pagamento._

**Body (JSON):**

```json
{
  "paymentMethod": "pix",
  "amount": 150.0,
  "title": "Consultoria mensal",
  "description": "Referente a julho/2026",
  "dueDate": "2026-07-31",
  "expiration": 3600,
  "customer": {
    "name": "Maria Souza",
    "email": "maria@example.com",
    "documentNumber": "98765432100",
    "phone": "48991234567"
  },
  "metadata": {
    "referencia": "contrato-123"
  },
  "boletoInstructions": {
    "fine": 2,
    "interest": 1,
    "discount": {
      "amount": 5,
      "modality": "fixed",
      "limitDate": "2026-07-30"
    }
  }
}
```

> **Enums:** paymentMethod: pix | boleto | creditcard    boletoInstructions.discount.modality: fixed | percent

**Respostas:**

<details>
<summary><code>200</code> — 200 — Pix</summary>

```json
{
  "chargeId": "cha_1780000000000_abcdef123",
  "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/example5204000053039865802BR5909ValidaPix6013Florianopolis62070503***6304ABCD",
  "qrCode": "data:image/png;base64,iVBOR..."
}
```

</details>

<details>
<summary><code>200</code> — 200 — Boleto</summary>

```json
{
  "chargeId": "cha_1780000000001_xyz789",
  "digitableLine": "03399.00000 00000.000000 00000.000000 1 00000000025000",
  "barCode": "03391000000000000000000000000000100000002500000",
  "dueDate": "2026-07-31",
  "pdfUrl": "/v1/charges/cha_1780000000001_xyz789/boleto.pdf"
}
```

</details>

<details>
<summary><code>200</code> — 200 — Cartão de crédito</summary>

```json
{
  "chargeId": "cha_1780000000002_cc456",
  "status": "PAID",
  "amount": 199.9,
  "paymentType": "CREDIT_CARD",
  "installments": 3
}
```

</details>


### Status de cobrança

```
GET {{base_url}}/v1/charges/:chargeId
```

**Escopo necessário:** `pix.cob/read`

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:chargeId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
    "chargeId": "cha_1771453171013_fp6iocaxb",
    "status": "PAID",
    "amount": 0.2,
    "paymentType": "PIX",
    "emv": "00020101021226910014br.gov.bcb.pix2569qrcode.pix.celcoin.com.br/pixqrcode/v2/bfc2182e025f97f17f843ae1fe8a895204000053039865802BR5909ValidaPix6013Florianopolis62070503***63049C4E",
    "paidAt": "2026-02-18T22:22:50.031Z",
    "createdAt": "2026-02-18T22:19:31.013Z",
}
```

</details>

<details>
<summary><code>200</code> — 200 — PENDING</summary>

```json
{
  "chargeId": "cha_1771453171013_fp6iocaxb",
  "status": "PENDING",
  "amount": 10.0,
  "paymentType": "PIX",
  "emv": "00020101021226910014br.gov.bcb.pix...",
  "createdAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>200</code> — 200 — ARCHIVED</summary>

```json
{
  "chargeId": "cha_1771453171013_fp6iocaxb",
  "status": "ARCHIVED",
  "amount": 10.0,
  "archivedAt": "2026-06-10T10:05:00.000Z",
  "createdAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Cobrança não encontrada</summary>

```json
{
  "error": {
    "message": "Cobrança cha_xxx não encontrada",
    "code": "CHARGE_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Cancelar cobrança

```
DELETE {{base_url}}/v1/charges/:chargeId
```

**Escopo necessário:** `pix.cob/write`

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:chargeId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200</summary>

```json
{
  "message": "Cobrança cancelada com sucesso",
  "chargeId": "cha_1779239661689_g1ugeix0e"
}
```

</details>

<details>
<summary><code>400</code> — 400 — Cobrança já paga</summary>

```json
{
  "error": {
    "message": "Não é possível cancelar uma cobrança com status PAID",
    "code": "CHARGE_ALREADY_PAID",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>

<details>
<summary><code>404</code> — 404 — Não encontrada</summary>

```json
{
  "error": {
    "message": "Cobrança cha_xxx não encontrada",
    "code": "CHARGE_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


---

## Assinaturas (Recorrência)

Modelo de cobrança recorrente atrelado a um Produto/Preço. Ciclos automáticos de cobrança conforme o `recurrenceType` do preço. Suporta upgrade (troca de plano com cobrança pro-rata imediata) e downgrade (agendado para o próximo ciclo).

**Ciclo de status:** `TRIALING` → `ACTIVE` → `PAST_DUE` → (`CANCELED` | `PAUSED`)

### Listar assinaturas

```
GET {{base_url}}/v1/subscriptions
```

**Query params:**

| Parâmetro | Exemplo | Obrigatório | Descrição |
|-----------|---------|-------------|-----------|
| `limit` | `20` | não | Quantidade de itens por página (padrão: 50) |
| `lastKey` | `` | não | Cursor da próxima página retornado na resposta anterior (base64) |
| `status` | `ACTIVE` | não | Filtro por status: ACTIVE | PENDING | CANCELED | PAST_DUE | PAUSED |
| `search` | `` | não | Busca por nome ou e-mail do cliente (case-insensitive) |
| `document` | `` | não | Filtro por CPF ou CNPJ do cliente (exact match) |
| `paymentMethod` | `` | não | Filtro por método de pagamento: CREDIT_CARD | PIX | BOLETO |
| `paymentType` | `` | não | Filtro por tipo de pagamento |
| `startDate` | `` | não | Data de início do período (ISO 8601, ex: 2026-01-01T00:00:00.000Z) |
| `endDate` | `` | não | Data de fim do período (ISO 8601, ex: 2026-12-31T23:59:59.999Z) |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Lista de assinaturas</summary>

```json
{
  "data": [
    {
      "subscriptionId": "sub_1772275462312_abcdef",
      "status": "ACTIVE",
      "paymentMethod": "CREDIT_CARD",
      "amount": 99.9,
      "customerId": "cus_1772230075378_21n6ykyb9",
      "productId": "prod_1772275462312_lsopu8ntr",
      "currentPeriodStart": "2026-06-01T00:00:00.000Z",
      "currentPeriodEnd": "2026-07-01T00:00:00.000Z",
      "createdAt": "2026-01-15T10:00:00.000Z"
    }
  ],
  "hasMore": false,
  "lastKey": null
}
```

</details>


### Buscar assinatura por ID

```
GET {{base_url}}/v1/subscriptions/:subscriptionId
```

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:subscriptionId` | ID da assinatura (ex: sub_xxxx) |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Assinatura encontrada</summary>

```json
{
  "subscriptionId": "sub_1772275462312_abcdef",
  "status": "ACTIVE",
  "paymentMethod": "CREDIT_CARD",
  "amount": 99.9,
  "interval": "MONTHLY",
  "customerId": "cus_1772230075378_21n6ykyb9",
  "customer": {
    "name": "Isaac Newton",
    "email": "isaac@example.com",
    "documentNumber": "12345678920"
  },
  "items": [
    {
      "itemId": "item_xxxx",
      "priceId": "price_xxxx",
      "quantity": 1,
      "amount": 99.9,
      "status": "ACTIVE"
    }
  ],
  "currentPeriodStart": "2026-06-01T00:00:00.000Z",
  "currentPeriodEnd": "2026-07-01T00:00:00.000Z",
  "createdAt": "2026-01-15T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Assinatura não encontrada</summary>

```json
{
  "error": {
    "message": "Assinatura sub_xxxx não encontrada",
    "code": "SUBSCRIPTION_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Calcular Pro Rata

```
POST {{base_url}}/v1/subscriptions/prorata
```

**Body (JSON):**

```json
{
  "subscriptionId": "sub_xxxx",
  "old": {
    "priceId": "price_xxxx"
  },
  "new": {
    "priceId": "price_yyyy",
    "quantity": 1
  }
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Pro rata calculado</summary>

```json
{
  "prorataAmount": 45.16,
  "daysRemaining": 15,
  "totalDays": 31,
  "currentAmount": 99.9,
  "newAmount": 149.9
}
```

</details>


### Upgrade de plano

```
POST {{base_url}}/v1/subscriptions/update
```

**Body (JSON):**

```json
{
  "subscriptionId": "sub_xxxx",
  "old": {
    "itemId": "item_xxxx"
  },
  "new": {
    "priceId": "price_yyyy",
    "quantity": 1
  }
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Upgrade realizado</summary>

```json
{
  "success": true,
  "subscriptionId": "sub_xxxx",
  "item": {
    "itemId": "item_yyyy",
    "priceId": "price_yyyy",
    "amount": 149.9,
    "status": "ACTIVE"
  },
  "proRataCharge": {
    "chargeId": "cha_xxx",
    "amount": 45.16,
    "status": "PAID"
  }
}
```

</details>

<details>
<summary><code>400</code> — 400 — Assinatura não elegível</summary>

```json
{
  "error": {
    "message": "A assinatura não está em um status elegível para upgrade (ACTIVE ou PAST_DUE)",
    "code": "SUBSCRIPTION_NOT_ELIGIBLE",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Downgrade de plano

```
POST {{base_url}}/v1/subscriptions/update
```

**Body (JSON):**

```json
{
  "subscriptionId": "sub_xxxx",
  "old": {
    "itemId": "item_xxxx"
  },
  "new": {
    "priceId": "price_xxxx",
    "quantity": 1
  }
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Downgrade agendado</summary>

```json
{
  "success": true,
  "subscriptionId": "sub_xxxx",
  "scheduledChange": {
    "effectiveDate": "2026-07-01T00:00:00.000Z",
    "newPriceId": "price_xxxx",
    "newAmount": 49.9
  }
}
```

</details>


### Cancelar assinatura

```
POST {{base_url}}/v1/subscriptions/update
```

**Body (JSON):**

```json
{
  "subscriptionId": "sub_xxxx",
  "action": "cancel"
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Assinatura cancelada</summary>

```json
{
  "success": true,
  "subscriptionId": "sub_xxxx",
  "status": "CANCELED",
  "canceledAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Assinatura não encontrada</summary>

```json
{
  "error": {
    "message": "Assinatura sub_xxxx não encontrada",
    "code": "SUBSCRIPTION_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Adicionar item à assinatura

```
POST {{base_url}}/v1/subscriptions/:subscriptionId/items
```

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:subscriptionId` | ID da assinatura |

**Body (JSON):**

```json
{
  "priceId": "price_xxxx",
  "quantity": 1
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Item adicionado (cartão)</summary>

```json
{
  "success": true,
  "item": {
    "itemId": "item_xxxx",
    "priceId": "price_xxxx",
    "amount": 99.9,
    "status": "ACTIVE",
    "quantity": 1
  },
  "proRataCharge": {
    "chargeId": "cha_xxx",
    "amount": 29.97,
    "status": "PAID"
  }
}
```

</details>

<details>
<summary><code>200</code> — 200 — Item adicionado (PIX/Boleto)</summary>

```json
{
  "success": true,
  "item": {
    "itemId": "item_xxxx",
    "priceId": "price_xxxx",
    "amount": 99.9,
    "status": "PENDING_UPGRADE",
    "quantity": 1
  },
  "proRataCharge": {
    "chargeId": "cha_xxx",
    "emv": "00020101...",
    "amount": 29.97,
    "status": "PENDING"
  }
}
```

</details>

<details>
<summary><code>404</code> — 404 — Assinatura não encontrada</summary>

```json
{
  "error": {
    "message": "Assinatura sub_xxxx não encontrada",
    "code": "SUBSCRIPTION_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


---

## Cupons de Desconto

Cupons de desconto aplicáveis em checkouts e assinaturas. Suportam desconto percentual (`PERCENTAGE`) ou valor fixo (`FIXED`). Podem ter limite de usos, limite de ciclos em assinaturas, valor mínimo de pedido, e validade por data.

### Criar cupom

```
POST {{base_url}}/v1/coupons
```

**Escopo necessário:** `coupons/write`

Cria um novo cupom de desconto. O cupom pode ser de valor fixo (`FIXED`) ou percentual (`PERCENTAGE`) e pode ser configurado com limite de resgates, validade e restrição por tipo de cobrança.

**Body (JSON):**

```json
{
  "code": "PROMO10",
  "name": "Promoção 10%",
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "maxRedemptions": 100,
  "maxCycles": 3,
  "minAmount": 50.0,
  "validFrom": "2026-01-01T00:00:00.000Z",
  "validUntil": "2026-12-31T23:59:59.000Z",
  "appliesTo": "RECURRING",
  "firstTimeOnly": false
}
```

**Respostas:**

<details>
<summary><code>201</code> — 201 — Cupom criado</summary>

```json
{
  "couponId": "cpn_1772275462312_abcdef",
  "code": "PROMO10",
  "name": "Promoção 10%",
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "status": "ACTIVE",
  "maxRedemptions": 100,
  "maxCycles": 3,
  "minAmount": 50.0,
  "appliesTo": "RECURRING",
  "firstTimeOnly": false,
  "validFrom": "2026-01-01T00:00:00.000Z",
  "validUntil": "2026-12-31T23:59:59.000Z",
  "createdAt": "2026-06-10T10:00:00.000Z"
}
```

</details>


### Listar cupons

```
GET {{base_url}}/v1/coupons?limit=20&status=ACTIVE
```

**Escopo necessário:** `coupons/read`

Lista todos os cupons criados na conta, com suporte a filtros e paginação cursor-based.

**Query params:**

| Parâmetro | Exemplo | Obrigatório | Descrição |
|-----------|---------|-------------|-----------|
| `limit` | `20` | sim | optional - itens por página (padrão: 50) |
| `status` | `ACTIVE` | sim | optional - ACTIVE, PAUSED ou INACTIVE |
| `lastKey` | `` | não | optional - cursor da próxima página (base64) |
| `search` | `` | não | optional - busca por código ou nome |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Lista de cupons</summary>

```json
{
  "data": [
    {
      "couponId": "cpn_xxx",
      "code": "PROMO10",
      "discountType": "PERCENTAGE",
      "discountValue": 10,
      "status": "ACTIVE",
      "maxRedemptions": 100,
      "redemptionsCount": 5
    }
  ],
  "hasMore": false,
  "lastKey": null
}
```

</details>


### Buscar cupom por ID

```
GET {{base_url}}/v1/coupons/:couponId
```

**Escopo necessário:** `coupons/read`

Retorna os detalhes de um cupom específico, incluindo estatísticas de uso.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:couponId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Cupom encontrado</summary>

```json
{
  "couponId": "cpn_xxx",
  "code": "PROMO10",
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "status": "ACTIVE",
  "redemptionsCount": 5,
  "createdAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Cupom não encontrado</summary>

```json
{
  "error": {
    "message": "Cupom cpn_xxx não encontrado",
    "code": "COUPON_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Atualizar cupom

```
PUT {{base_url}}/v1/coupons/:couponId
```

**Escopo necessário:** `coupons/write`

Atualiza os dados de um cupom existente. Todos os campos são opcionais.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:couponId` | ID do recurso |

**Body (JSON):**

```json
{
  "name": "Promoção 10% - Atualizado",
  "maxRedemptions": 200,
  "validUntil": "2027-12-31T23:59:59.000Z"
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Cupom atualizado</summary>

```json
{
  "couponId": "cpn_xxx",
  "code": "PROMO10",
  "name": "Promoção 10% - Atualizado",
  "status": "ACTIVE",
  "updatedAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Cupom não encontrado</summary>

```json
{
  "error": {
    "message": "Cupom cpn_xxx não encontrado",
    "code": "COUPON_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Atualizar status do cupom

```
PATCH {{base_url}}/v1/coupons/:couponId/status
```

**Escopo necessário:** `coupons/write`

Atualiza apenas o status de um cupom. Use `PAUSED` para suspender temporariamente sem excluir, e `INACTIVE` para desativar definitivamente.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:couponId` | ID do recurso |

**Body (JSON):**

```json
{
  "status": "PAUSED"
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Status atualizado</summary>

```json
{
  "couponId": "cpn_xxx",
  "code": "PROMO10",
  "status": "PAUSED",
  "updatedAt": "2026-06-10T10:00:00.000Z"
}
```

</details>

<details>
<summary><code>400</code> — 400 — Status inválido</summary>

```json
{
  "error": {
    "message": "Cupom com status INACTIVE não pode ser reativado",
    "code": "COUPON_INACTIVE_CANNOT_REACTIVATE",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Deletar cupom

```
DELETE {{base_url}}/v1/coupons/:couponId
```

**Escopo necessário:** `coupons/write`

Deleta permanentemente um cupom. Cupons já utilizados em assinaturas não podem ser deletados.

**Parâmetros de rota:**

| Parâmetro | Descrição |
|-----------|-----------|
| `:couponId` | ID do recurso |

**Respostas:**

<details>
<summary><code>200</code> — 200 — Cupom deletado</summary>

```json
{
  "message": "Cupom deletado com sucesso",
  "couponId": "cpn_xxx"
}
```

</details>

<details>
<summary><code>404</code> — 404 — Cupom não encontrado</summary>

```json
{
  "error": {
    "message": "Cupom cpn_xxx não encontrado",
    "code": "COUPON_NOT_FOUND",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


### Validar cupom

```
POST {{base_url}}/v1/coupons/validate
```

Valida um cupom sem autenticação — ideal para verificar se o cupom é válido antes de exibir o desconto no checkout. Retorna `valid: true` e os detalhes do cupom se válido, ou `valid: false` com o motivo da rejeição.

> ⚠️ **Atenção:** Este endpoint é público e não requer autenticação.

**Body (JSON):**

```json
{
  "code": "PROMO10",
  "amount": 100.0,
  "productIds": [
    "prod_xxxx"
  ],
  "chargeType": "RECURRING",
  "customerDocument": "12345678920"
}
```

**Respostas:**

<details>
<summary><code>200</code> — 200 — Cupom válido</summary>

```json
{
  "valid": true,
  "couponId": "cpn_xxx",
  "code": "PROMO10",
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "discountAmount": 10.0,
  "finalAmount": 90.0
}
```

</details>

<details>
<summary><code>400</code> — 400 — Cupom inválido ou expirado</summary>

```json
{
  "error": {
    "message": "Cupom PROMO10 expirado ou não é válido para este produto",
    "code": "COUPON_INVALID",
    "details": null,
    "timestamp": "2026-06-10T10:00:00.000Z"
  }
}
```

</details>


---

---

## Glossário de IDs e Prefixos

| Prefixo | Recurso |
|---------|---------|
| `cha_` | Cobrança (charge) |
| `sub_` | Assinatura (subscription) |
| `prod_` | Produto (product) |
| `price_` | Preço de produto |
| `item_` | Item de assinatura |
| `cus_` | Cliente (customer) |
| `cpn_` | Cupom (coupon) |
| `txn_` | Transação de carteira |
| `prop_` | Proposta de subconta |

---

## Webhooks

A ValidaPay envia notificações via webhook para a URL informada no campo `webhookUrl` da cobrança.
O payload segue o formato:

```json
{
  "event": "charge.paid",
  "chargeId": "cha_xxxx",
  "status": "PAID",
  "amount": 10.00,
  "paidAt": "2026-06-10T10:00:00.000Z",
  "metadata": { "externalId": "pedido-123" }
}
```

**Eventos possíveis:** `charge.paid`, `charge.canceled`, `charge.archived`, `charge.refunded`, `subscription.active`, `subscription.past_due`, `subscription.canceled`