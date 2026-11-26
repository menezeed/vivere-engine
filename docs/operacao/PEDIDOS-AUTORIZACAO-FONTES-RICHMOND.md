# Pedidos de autorização de reutilização: fontes Richmond (rascunhos para o PO)

**Estado:** rascunhos. **Nada foi enviado.** O PO revê e envia, ou pede alterações.

**Critério do PO (26/11/2026):** só se ingere no staging uma fonte com permissão de reutilização **confirmada**. "Não encontrei restrições" não chega.

| Fonte | Situação | Contacto (institucional, lido na página oficial) | Pedido |
|---|---|---|---|
| Age UK Richmond upon Thames | Os termos proíbem reproduzir e armazenar sem consentimento escrito | info@ageukrichmond.org.uk; The White House Community Centre, 45 The Avenue, Hampton, TW12 3RN | A (abaixo); detalhe em `PEDIDO-AUTORIZACAO-AGEUK-RICHMOND.md` |
| Ruils Independent Living | A "Website User Policy" proíbe publicar sem autorização escrita | **a confirmar pelo PO** na página Contact da Ruils (não foi lido) | A |
| Hampton & Hampton Hill Voluntary Care (Greenwood) | Sem termos; não há licença explícita. 4 actividades em curadoria (PR #66); **gravação em staging autorizada pelo PO a 26/11/2026 antes da resposta** | enquiries@greenwoodcommunity.org.uk (endereço geral, página de actividades, 26/11/2026) | B |
| Richmond Good Neighbours | Rodapé "© Richmond Good Neighbours"; não há licença explícita. 1 actividade (Cambrian Teas) **retida**: obras no local, datas incertas. No pedido, perguntar também pelas datas | organiser@richmondgoodneighbours.org.uk (endereço de função); ETNA, 13 Rosslyn Road, East Twickenham, TW1 2AR | B |
| Richmond Council (directório "Cost of Living", bibliotecas) | Termos: "personal and non commercial use". A licença OGL só cobre os datasets DataRich | **a confirmar pelo PO** (Open Data / Communications) | C |

## A — Organizações cujos termos exigem consentimento escrito

> **Subject:** Permission to list your public activities for older people (with links back to you)
>
> Dear [organisation] team,
>
> I am writing on behalf of [organisation], which is developing Vivere, a free guide that helps people aged 60+ find local activities. We are running a small, non-public pilot in the London Borough of Richmond upon Thames.
>
> Your website terms ask for written permission before content is reused, so we are asking before we use anything.
>
> **What we would like to do:**
> - list only the basic facts of your public activities: name, day and time, venue, cost if published, and who the activity is for;
> - always link to the original page on your website and name you as the organiser;
> - not copy your descriptions, images or logos, and not store any names, e-mail addresses or phone numbers of staff or volunteers;
> - check your pages no more than once a week, following your robots.txt, and correct or remove any listing on request.
>
> We would not sell or share the data, present ourselves as you, or take bookings on your behalf.
>
> Could you tell us whether this is acceptable? You may prefer to send us your programme directly (for example as a spreadsheet or calendar feed). If you would rather we did not list your activities, we will respect that.
>
> Kind regards,
> [name], [role] — [organisation] — [reply e-mail]

## B — Organizações sem termos explícitos (confirmar a autorização)

> **Subject:** May we list your activities for older residents in a free local guide?
>
> Dear [organisation] team,
>
> We are piloting Vivere, a free guide to activities for people aged 60+ in Richmond upon Thames. Your website lists activities that would be helpful to older residents, such as [actividades: ex. "FLexercise Over 60s and your Men's and Women's Social Groups" / "Cambrian Teas"].
>
> We would like to show only the basic facts (name, day and time, venue, cost if published) with a link back to your website, naming you as the organiser. We would not copy descriptions, images or personal details. We would correct or remove anything on request.
>
> Would you be happy for us to do this? A short reply by e-mail is enough. If you prefer, you could send us updates directly whenever your timetable changes.
>
> Kind regards,
> [name], [role] — [organisation] — [reply e-mail]

## C — Richmond Council: reutilização de listagens ou publicação como dados abertos

> **Subject:** Reuse of community activity listings for older residents (open data request)
>
> Dear Open Data / Communications team,
>
> We are piloting Vivere, a free guide to activities for residents aged 60+ in Richmond upon Thames. The council's pages list useful activities for older residents, for example the community activities in libraries and the Cost of Living community spaces directory.
>
> Your website terms limit reuse to personal, non-commercial use, and your Open Government Licence datasets (DataRich) do not include these listings. Would the council either:
> 1. allow us to list the basic facts (name, day and time, venue, cost if published, link to the council page), or
> 2. publish these listings as open data (for example a CSV or calendar feed under the OGL)?
>
> We would always link to the council's page and correct or remove anything on request.
>
> Kind regards,
> [name], [role] — [organisation] — [reply e-mail]

## Depois da resposta
- **Autoriza:** registar o e-mail de autorização (data, remetente institucional, âmbito) junto deste documento; só então correr o seed e o `--apply` da fonte.
- **Autoriza com limites:** ajustar o âmbito (ex.: só ligação) e documentar.
- **Recusa ou sem resposta:** a fonte fica fora do catálogo.
