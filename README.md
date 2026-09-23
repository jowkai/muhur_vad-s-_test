# Mühür Vadisi — Three.js graph/gauntlet paketi

Bu paket 23 node, 43 edge,7 proje skill'i ve gerçek Python task engine içerir.
Henüz çalışan oyun veya SVG'leri üretmez. `run` komutuyla Codex oyun kodunu geliştirmeye başlar.
Kurulum ile kod geliştirme birbirinden ayrıdır. Kurucu boş klasöre dosyaları yazar, Codex çağırmaz.

## Mac üzerinde başlangıç
Python3.9+,Git,Node/npm ve hesabınla giriş yapılmış Codex CLI gerekir. Scriptler macOS/Linux
içindir;Windows için WSL. Bu paket uzak site yayınlamaz veya kişisel skill kurmaz.

İndirilen kurucuyu Downloads altında tut; yeni/boş Desktop/muhur-vadisi klasörünü hedefle:
```bash
python3 ~/Downloads/muhur-vadisi-kurulum.py --dest ~/Desktop/muhur-vadisi
cd ~/Desktop/muhur-vadisi
git init
git add .
git commit -m "Add game graph and gauntlet"
python3 task_engine.py plan
```
Buraya kadar yalnız tasarım/otomasyon dosyaları hazırlandı. Oyun geliştirmesini şimdi başlat:
```bash
python3 task_engine.py run --max-tasks 1 --max-codex-calls 6 --timeout 900
python3 task_engine.py status
```
G00 Vite/Three.js/test altyapısını kurar. Araç/ağ yetkisi yoksa hata giderilmeden tekrar sınırsız deneme yapma.
İlerleyen parti için:
```bash
python3 task_engine.py run --max-tasks 4 --max-codex-calls 24 --timeout 900
```
`--timeout` her alt süreç içindir;toplam süre/para tavanı değildir. Her node3 deneme ile sınırlıdır.
CLI kendi tanımlı Codex modelini kullanır;paket özel model erişimin olduğunu varsaymaz.

## Hata sonrası
`status` çıktısını ve `.loop/NODE/ATTEMPT/` kanıtını oku. Ortam sorununu giderdikten veya
manuel kod değişikliğini inceledikten sonra gerçek başarısız node kimliğiyle:
```bash
python3 task_engine.py reset G00
python3 task_engine.py run --max-tasks 1
```
Reset kaynak silmez;seçili node ve bütün bağımlılarının başarılarını geçersiz kılar.
Emin olmadığın geniş değişiklikte başlangıç node'unu reset et. Graph değiştiyse eski state'i
arşivleyip yeniden başlamak gerekir. Eski başarıyı yeni kaynağa taşımak doğru değildir.
Kilit kaldıysa kaydedilen PID'nin çalışmadığını kontrol etmeden silme.

## Yedi rol nasıl çalışıyor?
coordinator/world/render/combat/content/ui/qa. Her görev atanan rolün talimatıyla yeni Codex
oturumu alır;başka rol read-only review yapar. Motor **sıralı tek yazıcı** kullanır;
yedi paralel terminal/worktree çalıştırmaz. Paket hazırlanırken6 uzman+koordinatör kullanıldı.
İleride paralelleştirme için ayrı worktree,merge conflict gate ve ortak lockfile sahibi gerekir.

## Gauntlet ve skor
Gerçek gate→farklı reviewer→checkpoint. Final oyun skoru için:
```bash
python3 qa/score_current.py --identity
python3 qa/score_current.py
```
İlk komut QA evidence için commit/source kimliği verir. Evidence `.loop/evidence/evidence.json`.
Eksikse puan yok;başarı için85/100,herkriter60ve6hardgatePASS gerekir.
Puan veren dosyaların varlığı sonucu kanıtlamaz;QA gerçek içerik ve test kaynaklarını inceler.

## Paketi test etmek
```bash
python3 engine/test_task_engine.py
python3 -m unittest discover -s qa -p 'test_*.py'
```
Bu testler Python otomasyon/scorer davranışıdır;Three.js oyununun hazır olduğunun kanıtı değildir.
Canlı Codex ve fizikselGPU entegrasyonu bu hazırlıkta çalıştırılmadı.

## Dosyalar
AGENTS.md temel kurallar;SKILLS.md index;.agents/skills altında7 rol;docs/ tasarım;
workflow/graph.json node/edge;task_engine.py giriş;engine/ gerçek motor;qa/ score/test;
design/catalog.seed.json örnek tür ve item verisi.
Noktalı klasörler Finder'da Command+Shift+. ile görünür.
G00 sonrası `npm run dev` geliştirilen uygulamayı açar;kurulumdan hemen sonra npm uygulaması yoktur.

## Kaynaklar
[Codex exec](https://developers.openai.com/codex/noninteractive),
[AGENTS.md](https://developers.openai.com/codex/guides/agents-md),
[Repo skills](https://developers.openai.com/codex/skills),
[OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html),
[InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).
Sayısal oyun bütçeleri ve formüller projeye özel tasarım kararıdır.
