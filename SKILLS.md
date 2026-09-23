# Proje skill dizini
Bu dosya bir yol haritasıdır; tek başına otomatik skill motoru değildir.
Gerçek instruction dosyaları .agents/skills altındadır ve engine graph.agents rolüne göre yükler.

| Rol | Skill | Temel sahiplik |
|---|---|---|
| coordinator | muhur-coordinator | Ortak contracts, save altyapısı, entegrasyon ve QA review |
| world | muhur-world | Harita, biyom, hareket, chunk ve encounter |
| render | muhur-render | Three.js, kamera, GPU kaynakları ve profil |
| combat | muhur-combat | Savaş state machine, yakalama, XP ve ödül |
| content | muhur-content | Türler, SVG'ler, itemler ve simya |
| ui | muhur-ui | HUD/minimap, savaş, çanta ve simya paneli |
| qa | muhur-qa | Tests, gerçek browser, evidence ve puan |

Toplam7 rol; başka alt agent yok. Her node'un agent ve farklı review_agent alanı vardır.
Skill'ler bu projeye aittir; kişisel ChatGPT skill kurulumunu değiştirmez.
