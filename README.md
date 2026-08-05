# Carpa Diem Online — MVP 6

Versão multiplayer em tempo real do jogo abstrato de criação e circulação de carpas.

## Recursos desta versão

- salas para 2 a 4 jogadores;
- entrada como jogador ou espectador;
- reconexão por código, nome e token local;
- aviso persistente quando um jogador sai ou perde a conexão;
- pausa automática da partida até o retorno de todos;
- aviso central quando a conexão com o servidor cai;
- tabuleiro 7×5 com 12 movimentos por rodada e 10 rodadas por partida;
- alga, cardume, correção do vazio e Correnteza;
- desfazer movimentos;
- reposição em sequência: ao acabar a menor cor, passa-se para a próxima menor;
- cada carpa retirada rende 1 moeda;
- 3 moedas compram 1 movimento extra;
- desempate final por quantidade de moedas;
- resultado final em uma janela central com classificação completa;
- pontuação parcial durante a partida;
- interface desktop e mobile;
- persistência opcional de salas no MongoDB Atlas;
- histórico de partidas finalizadas;
- painel administrativo protegido em `/dev-salas`.

## Executar localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm start
```

Abra:

```text
http://localhost:3000/device.html
```

Sem `MONGODB_URI`, o jogo funciona normalmente em modo memória. Nesse modo, salas abertas desaparecem quando o servidor reinicia.

## Variáveis de ambiente

Copie `.env.example` como referência. O projeto não carrega `.env` automaticamente; no computador, defina as variáveis no terminal ou use a ferramenta de sua preferência. No Render, configure-as na área **Environment**.

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB=carpas_online
ADMIN_PASSWORD=uma-senha-forte
ROOM_TTL_HOURS=72
```

Nunca publique a URI do Atlas nem a senha administrativa no GitHub.

## MongoDB Atlas

Quando `MONGODB_URI` está configurada, o servidor usa:

- `active_rooms`: estado completo das salas em andamento;
- `match_records`: partidas finalizadas, classificação, moedas, tabuleiros finais e registros;
- índice TTL nas salas ativas, controlado por `ROOM_TTL_HOURS`.

Depois de um reinício do servidor, as salas são recuperadas. Todos os participantes aparecem inicialmente como desconectados e a partida permanece pausada até que retornem.

## Painel de registros

Acesse:

```text
http://localhost:3000/dev-salas
```

O navegador solicitará autenticação básica. O nome de usuário pode ser qualquer valor; a senha deve ser exatamente a variável `ADMIN_PASSWORD`.

O painel mostra:

- salas ativas;
- jogadores e espectadores conectados;
- rodada e fase atuais;
- moedas;
- partidas finalizadas;
- vencedor, pontuação, duração e detalhes completos;
- logs e tabuleiros finais.

## Testes

```bash
npm test
```

Os testes cobrem preparação, espectadores, reinício, Correnteza, orientação das peças, desfazer, retorno à sala, reposição em cascata, moedas, movimentos extras e desempate.

## Arquivos principais

```text
admin/dev-salas.html     painel administrativo
public/client.js         interface e comunicação Socket.IO
public/styles.css        visual e animações
src/game.js              regras e estado da partida
src/storage.js           persistência MongoDB Atlas
server.js                Express, Socket.IO, reconexão e rotas administrativas
```
