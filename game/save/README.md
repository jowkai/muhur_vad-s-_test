# IndexedDB kayıt adaptörü

`IndexedDbSave.open({ name, initial, validate })` ile açılır ve ortak `SavePort<T>`
sözleşmesini uygular. `validate` domain sahibinin gerçek oyun kayıt şemasını doğrulamalı
ve geçersiz veride hata atmalıdır. Testlerdeki mühür/XP örnekleri tam oyun şeması değildir.

- `load()` boş veritabanında null döner; otomatik başlangıç kaydı yazmaz.
- `transact(commandId, draft => ...)` eksik ilk kaydı initial ile kurar. Callback
  eşzamanlı olmalıdır; async/await reddedilir. Callback hiçbir dış yan etki üretmemelidir.
- Aynı commandId, önceki işlemin sonucunu döndürür; güncel kaydı eski sonuca geri almaz.
  Kimlikler her mantıksal işlem için benzersiz olmalı, retry sırasında korunmalıdır.
- records/current, records/backup ve commands aynı readwrite transaction içindedir.
  Promise yalnız oncomplete sonrasında çözülür. Hata transaction'ı bütünüyle geri alır.
- v1 `{version:1,data:T}` zarfı v2 `{version:2,state:T}` olur; orijinal yedeklenir.
  Bu zarf geçişidir. Gelecekteki gameplay schema geçişleri ayrıca tasarlanmalıdır.
- Bilinmeyen sürüm veya doğrulama hatası kaydı silmez. `exportRaw()` yedek, mevcut
  kayıt ve işlem defterini doğrulamadan dışa aktarmak için döndürür. Otomatik geri
  yükleme yapılmaz; eski state ile yeni ledger'ın karışmasına izin verilmez.
- `close()` bağlantıyı kapatır. `versionchange` bağlantıyı kapatarak yeni sürümü engellemez.
- `fault` yalnız testlerde kullanılır; uygulama entegrasyonunda verilmemelidir.

Tam oyun state'i ve kullanıcıya yönelik export/retry paneli sonraki entegrasyon
node'larına aittir. Adaptör henüz G00 sahne önizlemesine bağlanmadı.
