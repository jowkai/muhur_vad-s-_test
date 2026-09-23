# Mühür Vadisi — proje çalışma sözleşmesi

Amaç: Three.js ile üstten izlenen, geniş biyom haritasında keşif, yaratık/yumurta toplama,
sıra tabanlı savaş, yakalama, XP ve simya içeren özgün bir tek oyunculu tarayıcı oyunu.
Kullanıcı deneyimi Türkçe. Pokémon ve LoL yalnız tür/tür atmosferi referansıdır; karakter,
isim, harita, müzik, arayüz veya görsel kopyalama.

## Otorite ve bağlam
- workflow/graph.json görev sahipliği, bağımlılık ve kabul sözleşmesidir.
- docs/ARCHITECTURE.md ortak modül sınırlarını; docs/DECISIONS.md çelişki çözümlerini belirler.
- WORLD.md/RENDER.md/UI.md/COMBAT.md/CONTENT.md/GAUNTLET.md ilgili görevde okunur.
- SKILLS.md bir index'tir. Gerçek proje skill'leri .agents/skills/*/SKILL.md dosyalarındadır.
- Verilen görevin acceptance ve context alanlarını oku; sonraki düğümün işini gelişigüzel ekleme.
- Merkezi src/contracts/ dışına rakip tip/sözleşme kopyası yazma. Yeni ihtiyaçta mevcut sınırı
  koruyan adapter kullan; görevin scope'u yetmezse somut bağımlılık eksikliğini bildir.

## Ürün değişmezleri
- WASD ve oklar, normalize çapraz hareket, karakter yönü ve yumuşak takip kamera.
- Sol altta dairesel minimap; yakındaki hedef için büyük SVG, ad ve Enter ipucu.
- Yumurta savaşmadan alınır; vahşi yaratıkla Enter savaşı açar; saldırgan önce uyarır.
- Savaşta dost arkadan, rakip önden; dört saldırı slotu, ayrı Yakala ve Kaç.
- Düşük seviyeli yaratığın güçlü slotları kilitlidir; düşük HP olmadan yakalama yapılamaz.
- Toplama, simya, XP, yakalama ve save işlemleri commandId/transaction ile tekilleşir.
- Inventory/Alchemy/Battle açıkken hareket ve dünya aggro'su durur.
- 8 biyom bölgedir; rastgele renkli karelerle geniş harita şartını karşılanmış sayma.

## Uygulama sınırları
Vite + TypeScript + Three.js WebGLRenderer + DOM/SVG UI. Save IndexedDB, tek oyunculu offline-first.
React/backend/auth/multiplayer zorunluluğu yok. Sürümleri G00'da resmi dokümandan doğrula ve sabitle.
World XZ; Y yükseklik. Timestep 1/60; en fazla 5 catchup. Gameplay RNG ve görsel RNG ayrıdır.
SVG bizim ürettiğimiz kod varlıklarıdır; image-generation veya uzaktaki asset URL zorunluluğu yok.

## Gauntlet ve çalışma izni
Yalnız scope yollarında uygulama kodu/test yaz. Engine, graph, AGENTS, skill'ler, QA scorer ve
tasarım sözleşmelerini uygulama görevinde değiştirerek kontrolü gevşetme.
Test skip, boş suite'e başarı, koşulsuz exit0 ve sahte performans raporu yasaktır.
Gate'ler kaynak değiştiremez; raporlar .loop/evidence veya .reports altında tutulur.
Agent kendi işini onaylamaz; farklı rol fresh read-only oturumda inceler.
Reviewer gerçek kod ve raporları okur, yalnız uygulayıcı açıklamasına güvenmez.
Yerel paket kurulumu/derleme yetkili; canlı yayın, uzak hesap değişikliği ve production işlemi bu döngüde yok.
Engine checkpoint'ini agent yazmaz. Gerekli araç/erişim yoksa sonuçta açıkça BLOCKED de.
Global ayar, sandbox veya izin politikalarını genişleterek engeli aşma.
Her rol alt agent başlatmaz. Bu paketin yedi rolünü geçme; runtime yazıcısı bir tanedir.
