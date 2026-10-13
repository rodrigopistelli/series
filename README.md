# 🎬 CineSéries — Filmes e Séries: Top IMDb, Em Alta e Lançamentos

App **100% estático** (só `index.html` + `styles.css` + `app.js`). Sem build, sem backend, sem custo.
Busque **filmes e séries**, veja **maiores notas**, **lançamentos**, **títulos em alta**, filtre por **ano e nota**, com **capa original**.

## Como funciona (2 modos)

| Modo | O que usa | Chave? | Capas | Recursos |
|---|---|---|---|---|
| **Sem chave (funciona na hora)** | TVMaze (séries) + YTS (filmes) | Não | Originais dos provedores | Busca, em alta, top, lançamentos, filtro ano/nota/gênero, favoritos |
| **Completo (recomendado)** | TMDB | Sim, grátis (2 min) | Originais `image.tmdb.org/original` | Busca unificada, Trending, Top Rated, Upcoming, Discover com filtros na API |

Notas em escala 0–10 (compatível com IMDb). No detalhe há link direto para o IMDb quando disponível.

## 🚀 Hospedagem grátis (escolha 1 — leva ~2 minutos)

### Opção A — Netlify Drop (mais fácil, sem conta Git)
1. Acesse https://app.netlify.com/drop
2. Arraste **esta pasta** (`Séries`) para a página
3. Pronto: você ganha uma URL `https://seu-site.netlify.app`

### Opção B — Vercel
1. Acesse https://vercel.com → **Add New → Project** → **Upload** (ou conecte o GitHub)
2. Suba esta pasta. Framework Preset: **Other**. Sem build command.
3. Deploy → URL `https://seu-site.vercel.app`

### Opção C — Cloudflare Pages
1. https://pages.cloudflare.com → **Upload assets** → arraste a pasta
2. Deploy → URL `https://seu-site.pages.dev`

### Opção D — GitHub Pages
```bash
cd "C:\Estudos\IA\OpenCode\Séries"
git init && git add . && git commit -m "CineSéries"
# crie o repo no GitHub e:
git remote add origin https://github.com/SEU-USUARIO/cineseries.git
git branch -M main && git push -u origin main
```
Depois: repo → **Settings → Pages → Deploy from branch → main → /(root)**.

### Teste local
Só abrir `index.html` no navegador — ou melhor (evita bloqueio de `file://`):
```bash
npx serve .
# ou
python -m http.server 8000
```

## 🔑 Como pegar a chave grátis do TMDB (opcional, 2 min)
1. Crie conta em https://www.themoviedb.org/signup
2. Vá em https://www.themoviedb.org/settings/api → copie a **API Key (v3 auth)**
3. No app, clique em **🔑 API** → cole → **Salvar**
4. A chave fica salva só no seu navegador (`localStorage`). Para publicar com a chave embutida, **não** faça isso — cada visitante usa a própria chave.

## ✨ Recursos
- 🏠 Início (filmes do mês, meus stats, notícias) • 🔥 Em alta • 📚 Todos • 🏆 Maiores notas • 🆕 Lançamentos • 🎟 Em cartaz • 🔎 Busca • ✨ Assistente de momento
- Filtros: tipo (filme/série), ano (de–até), nota mínima (slider), gênero, ordenação
- ★ Dourado = nota real do IMDb (buscada sob demanda, sem chave); sem selo = nota da fonte. Ordenação e filtro de nota usam a nota da fonte.
- Sinopses e gêneros em português (tradução automática com cache no navegador).
- Cards com capa original, nota ★, ano, sinopse
- Modal de detalhes com link IMDb / trailer
- ★ Favoritos (localStorage) • Paginação "Carregar mais" • Layout responsivo dark

## 🔌 APIs
- Séries sem chave: `https://api.tvmaze.com/search/shows?q=...`, `/shows?page=N`, `/schedule?country=US&date=...` — imagens `original_untouched`
- Filmes sem chave: `https://yts.mx/api/v2/list_movies.json?sort_by=rating&minimum_rating=7&...` (com fallback `yts.am`, `yts.lt`) — `large_cover_image`
- Completo: `api.themoviedb.org/3/trending/all/week`, `/discover/movie`, `/discover/tv`, `/search/multi`, `/movie/top_rated` (`language=pt-BR`)

> **Limite do modo grátis:** a TVMaze não oferece "todas as estreias do ano X" — as páginas misturam anos. Por isso o filtro de ano no modo sem chave monta uma **amostra** (páginas mais novas + grade mensal do ano). Para um título exato, a **Busca pelo nome** usa o índice completo e acha tudo (ex.: `Spider-Noir`). Para navegar pelo catálogo inteiro de um ano, use a chave grátis do TMDB.

## 📁 Arquivos
- `index.html` — estrutura
- `styles.css` — visual
- `app.js` — lógica (TVMaze + YTS + TMDB)
- `netlify.toml`, `vercel.json` — configs de deploy
- `README.md` — este guia
