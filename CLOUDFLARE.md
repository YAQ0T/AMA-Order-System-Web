# دليل Cloudflare الكامل — رابط النظام الأونلاين `https://amaorders.work`

هاد الدليل بيمشي معك **خطوة بخطوة، شاشة بشاشة**، على **الماك** وعلى **الويندوز**: من فتح حساب Cloudflare لحد ما الموظفين يفتحوا النظام من تلفوناتهم من أي مكان بالعالم.

كل الشغل على الجهاز بيصير من ملف واحد بتكبس عليه دبل كليك:

| الجهاز | الملف (بمجلد المشروع) |
|---|---|
| الماك | **`Cloudflare AMA (Mac).command`** |
| الويندوز | **`Cloudflare AMA (Windows).cmd`** |

بيفتح قائمة بالأرقام، وكل رقم بيعمل شغلة:

```
  1) Connect this computer (installs cloudflared, asks for the token)
  2) Start the tunnel
  3) Stop the tunnel
  4) Test - is everything working?
  5) Show the tunnel log
  6) Remove the tunnel from this computer
  7) Update cloudflared to the newest version
  0) Exit
```

---

## الفهرس

1. [الفكرة بدقيقة](#1-الفكرة-بدقيقة)
2. [وين وصلنا](#2-وين-وصلنا)
3. [قبل ما تبلّش](#3-قبل-ما-تبلش)
4. [الجزء أ — داخل موقع Cloudflare (مرة وحدة)](#4-الجزء-أ--داخل-موقع-cloudflare-مرة-وحدة)
5. [الجزء ب — على الماك، شاشة بشاشة](#5-الجزء-ب--على-الماك-شاشة-بشاشة)
6. [الجزء ج — على الويندوز، شاشة بشاشة](#6-الجزء-ج--على-الويندوز-شاشة-بشاشة)
7. [الاستعمال اليومي](#7-الاستعمال-اليومي)
8. [كل خيار بالقائمة بالتفصيل](#8-كل-خيار-بالقائمة-بالتفصيل)
9. [شو معنى كل سطر بالفحص (الخيار 4)](#9-شو-معنى-كل-سطر-بالفحص-الخيار-4)
10. [رسائل الخطأ بالمتصفح](#10-رسائل-الخطأ-بالمتصفح)
11. [نقل الرابط من جهاز لجهاز](#11-نقل-الرابط-من-جهاز-لجهاز)
12. [التحديث](#12-التحديث)
13. [التوكن: سرّي — ولو انكشف](#13-التوكن-سري--ولو-انكشف)
14. [تركيب cloudflared باليد](#14-تركيب-cloudflared-باليد)
15. [الأوامر اليدوية الكاملة (للفني)](#15-الأوامر-اليدوية-الكاملة-للفني)
16. [أسئلة شائعة](#16-أسئلة-شائعة)

---

## 1. الفكرة بدقيقة

```
تلفون الموظف (من أي مكان)
        │  https://amaorders.work   (مشفّر)
        ▼
   Cloudflare  ◄──────── اتصال آمن بيفتحه الجهاز نفسه (ما في بورت مفتوح بالراوتر)
        │
        ▼
 جهاز الشركة: برنامج cloudflared  ──►  النظام على  http://localhost:6001
```

- **cloudflared** برنامج صغير من Cloudflare بيشتغل على نفس الجهاز اللي عليه النظام. هو اللي بيوصّل الجهاز بـ Cloudflare.
- بيتركّب **كخدمة** (service): يعني بيشتغل لحاله مع تشغيل الجهاز، حتى قبل ما حدا يسجّل دخول، وما بتحتاج تفتحه كل يوم.
- **التوكن (token)**: كود طويل بيبلّش بـ `eyJ`، بيعطيك ياه Cloudflare، وهو اللي بيربط الجهاز بالنفق تبعك. **سرّي زي كلمة السر.**
- جوّا الشركة النظام بيضل يشتغل عادي على عنوان الشبكة (مثل `http://192.168.1.33:6001`)، حتى لو النت مقطوع.

> ⚠️ **جهاز واحد بس بنفس الوقت.** البيانات على الجهاز اللي شغّال عليه النظام. لو ربطت الماك والويندوز الاتنين بنفس النفق، Cloudflare بيوزّع الزوار عليهم، فبيصير في **قاعدتين بيانات** (طلبات هون وطلبات هناك). الأداة وStart AMA بيحذّروك إذا صار هيك.

---

## 2. وين وصلنا

آخر فحص (8 نوفمبر 2026):

| الشغلة | الحالة |
|---|---|
| الدومين `amaorders.work` على Cloudflare (`kolton` و `maleah`.ns.cloudflare.com) | ✅ خلصت |
| `amaorders.work` و `www.amaorders.work` موجهين على النفق | ✅ خلصت (الخطأ صار **1033**، يعني الطريق للنفق موجود) |
| **جهاز مربوط بالنفق** | ❌ **لسا** — هاد الجاي: [الجزء ب (الماك)](#5-الجزء-ب--على-الماك-شاشة-بشاشة) |
| **Always Use HTTPS** | ❌ لسا مش مفعّلة — [أ5](#أ5-always-use-https) |

يعني الباقي فعلياً: **(1)** على الماك: Cloudflare AMA ← `1` ← الصق الأمر. **(2)** تفعيل Always Use HTTPS. **(3)** Cloudflare AMA ← `4` للتأكد.

---

## 3. قبل ما تبلش

تأكد من هالشغلات، وحدة وحدة:

1. **الجهاز الصح**: الجهاز اللي رح يضل عليه النظام (الماك غالباً). مش أي جهاز ثاني.
2. **النظام شغّال عليه**: دبل كليك **Start AMA**، ولازم يطلع `Running ... The database is ready`.
3. **المشروع محدّث**: على الماك، بالـ Terminal داخل مجلد المشروع: `git pull`، بعدين Stop AMA و Start AMA.
4. **إنترنت شغّال** على الجهاز.
5. **حساب أدمن على الجهاز**: الماك رح يطلب كلمة سر الماك، والويندوز رح يطلب إذن «Yes». لازم يكون الحساب مدير (Administrator) — حسابات الشركة العادية غالباً هيك.
6. **الدخول على Cloudflare**: إيميل وكلمة سر حساب Cloudflare.
7. **الجهاز ما بينام**: النظام والنفق ما بيشتغلوا والجهاز نايم.
   - الماك: Start AMA بيمنع النوم طول ما النظام شغّال وموصول بالكهربا. وكمان: System Settings ← **Energy** (أو Battery ← Options) ← فعّل «Prevent automatic sleeping when the display is off» و «Start up automatically after a power failure» إذا موجودين.
   - الويندوز: Settings ← System ← Power ← Screen and sleep ← «When plugged in, put my device to sleep after» ← **Never**.

---

## 4. الجزء أ — داخل موقع Cloudflare (مرة وحدة)

> أسماء الأزرار تحت هي زي ما Cloudflare كاتبها بالإنجليزي على موقعه (حسب شرحهم الرسمي، يونيو 2026). ممكن يتغيّر مكان زر شوي مع الوقت، بس الأسماء بتضل نفسها تقريباً.

### أ1. تسجيل الدخول

1. افتح المتصفح على **[dash.cloudflare.com](https://dash.cloudflare.com)**.
2. سجّل دخول بإيميل وكلمة سر حساب Cloudflare.
3. إذا عندك أكتر من حساب، اختار حساب الشركة.

### أ2. تأكد إنو الدومين Active

1. بالصفحة الرئيسية (Account Home) لازم تشوف `amaorders.work` وجنبه **Active**.
2. إذا مكتوب **Pending**: يعني الـ nameservers عند GoDaddy لسا مش تبع Cloudflare. الخطوات بآخر هالقسم ([أ6](#أ6-للمرجع-نقل-الدومين-من-godaddy--خلصت)).

### أ3. النفق: افتحه، وانسخ أمر التركيب

1. بالقائمة اللي عالشمال: **Networking** ← **Tunnels**.
   (بحسابات أقدم ممكن تلاقيها: **Zero Trust** ← **Networks** ← **Tunnels**.)
2. **إذا في نفق بالقائمة** (غالباً اسمه `ama-orders`): اكبس عليه ← تبويب **Overview** ← زر **Add a replica**.
   **إذا القائمة فاضية**: **Create a tunnel** ← اكتب اسم `ama-orders` ← **Create Tunnel**. (إذا سألك عن نوع الموصّل اختار **Cloudflared**.)
3. رح يسألك عن نظام التشغيل: اختار **macOS** (إذا رح تربط الماك) أو **Windows** (إذا الويندوز).
4. بيطلعلك أمر تركيب، شكله هيك تقريباً:
   - ماك: `sudo cloudflared service install eyJhIjoi...........`
   - ويندوز: `cloudflared.exe service install eyJhIjoi...........`
5. **انسخه** (في زر نسخ جنبه، أو حدّده كله و Ctrl+C / Cmd+C).
   - ❌ **ما تشغّله بإيدك** بالـ Terminal — أداة **Cloudflare AMA** رح تشغّله صح (بتركّب البرنامج كمان إذا مش موجود).
   - 🔒 **هاد الأمر فيه التوكن السرّي.** ما تبعته لحدا، ولا تحطه بإيميل أو واتساب، ولا حتى إلي.
6. خلّي الصفحة مفتوحة، وروح للجهاز: [الماك](#5-الجزء-ب--على-الماك-شاشة-بشاشة) أو [الويندوز](#6-الجزء-ج--على-الويندوز-شاشة-بشاشة). بعد ما تربطه، بترجع لهون وبتشوف الجهاز ظاهر تحت **Connectors**، وفي زر **Continue** إذا كنت عم تنشئ نفق جديد.

### أ4. الطرق (Routes): الدومين ← النظام

هاد اللي بيخلّي `amaorders.work` يوصل للنظام. **غالباً موجودين من قبل** (الفحص الأخير بيقول هيك) — بس تأكد:

1. **Networking** ← **Tunnels** ← اكبس على النفق ← تبويب **Routes**.
2. لازم تشوف سطرين من نوع **Published application**:

   | Hostname | Service |
   |---|---|
   | `amaorders.work` | `http://localhost:6001` |
   | `www.amaorders.work` | `http://localhost:6001` |

3. **إذا واحد ناقص**: **Add route** ← **Published application**، وعبّي:
   - **Subdomain**: فاضي (للرابط الأساسي) — أو `www` (للتاني).
   - **Domain**: اختار `amaorders.work` من القائمة.
   - **Path**: فاضي.
   - **Service URL**: `http://localhost:6001`  ← بالضبط هيك: `http`، مش `https`، و`localhost`، والرقم `6001`.
   - ← **Add route**.
4. إذا طلع خطأ إنو في سجل موجود بنفس الاسم (A / AAAA / CNAME): روح لـ `amaorders.work` ← **DNS** ← **Records**، احذف السجل القديم لنفس الاسم (غالباً سجل A بيأشر على `213.6.226.163` — النظام القديم)، وارجع أضف الطريق.

### أ5. Always Use HTTPS

هاد بيحوّل أي حدا بيكتب `http://amaorders.work` لـ `https://` تلقائياً.

1. من **Account Home** اكبس على `amaorders.work`.
2. بالقائمة عالشمال: **SSL/TLS** ← **Edge Certificates**.
3. انزل لتحت لحد **Always Use HTTPS** ← شغّل المفتاح (**On**).

### أ6. للمرجع: نقل الدومين من GoDaddy ✅ (خلصت)

هاي الخطوات اللي انعملت قبل، إذا احتجتها مرة ثانية:
1. Cloudflare: **Add a domain** ← `amaorders.work` ← خطة **Free** ← احذف سجلات A القديمة اللي بتأشر على `213.6.226.163` ← انسخ عنوانين الـ nameservers.
2. GoDaddy: **My Products** ← جنب `amaorders.work` ← **DNS** ← **Nameservers** ← **Change Nameservers** ← **I'll use my own nameservers** ← حط عنوانين Cloudflare ← **Save**.
3. Cloudflare: **Check nameservers**، واستنى لحد ما يصير **Active** (دقائق لساعات).

> 📅 **جدّد الدومين عند GoDaddy كل سنة** (أو فعّل التجديد التلقائي). إذا انتهى الدومين، الرابط بيوقف.

---

## 5. الجزء ب — على الماك، شاشة بشاشة

### ب1. افتح الملف

1. افتح **Finder** ← روح لمجلد المشروع `AMA-Order-System-Web`.
2. دبل كليك على **`Cloudflare AMA (Mac).command`**.
3. بينفتح **Terminal** (شباك فيه كتابة). هاد طبيعي.

**إذا الماك منع الفتح:**
- إذا طلعت رسالة إنو Apple ما قدرت تتأكد من الملف (Not Opened / unidentified developer):
  - اكبس **Done**، بعدين **System Settings** ← **Privacy & Security** ← انزل لتحت ← جنب اسم الملف اكبس **Open Anyway** ← كلمة سر الماك ← **Open**.
  - (بالنسخ الأقدم من macOS: كبسة يمين على الملف ← **Open** ← **Open**.)
  - هاد بيصير بس إذا المشروع منزّل كـ zip من المتصفح. إذا منزّل بـ `git clone` ما بيطلع.
- إذا طلع **permission denied**: افتح Terminal، اكتب `cd ` (مع مسافة)، اسحب مجلد المشروع جوّا الشباك، اكبس Return، وبعدين:
  ```
  chmod +x *.command
  ```
  وارجع دبل كليك.
- إذا قال **Node.js is not installed**: نزّل نسخة LTS من [nodejs.org](https://nodejs.org) وركّبها، وارجع.

### ب2. القائمة

بتشوف فوق حالة الجهاز:
```
  cloudflared:  not installed
  Tunnel here:  not connected
  Link:         (APP_URL not set in server/.env)
```
وتحتها الأرقام. **اكبس جوّا الشباك**، اكتب **`1`**، واكبس **Return**.

### ب3. تركيب cloudflared (أوتوماتيك)

إذا cloudflared مش مركّب، الأداة بتركّبه:
- **إذا عندك Homebrew**: بتكتب `Using Homebrew...` وبتركّبه (بياخد دقيقة أو اتنين).
- **إذا ما عندك**: بتنزّله من Cloudflare مباشرة:
  ```
  Downloading cloudflared for this Mac (Apple silicon)...
  Putting it in /usr/local/bin - enter this Mac's password if asked (typing shows nothing).
  Password:
  ```
  اكتب **كلمة سر الماك** (اللي بتفتح فيها الجهاز) واكبس Return.
  - ⚠️ **وانت عم تكتب كلمة السر ما بيطلع ولا إشي ع الشاشة** — ولا نقاط ولا نجوم. هاد طبيعي. اكتبها واكبس Return.

لازم يطلع بالآخر: `OK  cloudflared installed (2026.x.x ...)`.

### ب4. لصق أمر التركيب

بتشوف:
```
  In Cloudflare (dash.cloudflare.com) > Networking > Tunnels:
    - no tunnel yet:       Create a tunnel > name it (e.g. ama-orders) > Create Tunnel
    - tunnel made before:  click it > Overview > Add a replica
  choose macOS, and copy the command it shows (it holds a long code, the token).
  Paste it here (Cmd+V) - the whole command or just the token - then press Enter.

  Paste:
```
1. انسخ الأمر من صفحة Cloudflare ([أ3](#أ3-النفق-افتحه-وانسخ-أمر-التركيب)) — اختار **macOS**.
2. ارجع للـ Terminal، اكبس جوّا الشباك، و **Cmd+V**. بيطلع الأمر الطويل.
3. اكبس **Return**.
4. بيطلب كلمة سر الماك مرة ثانية (أو لأ إذا لسا كاتبها من شوي) ← اكتبها ← Return.

لازم يطلع:
```
  OK  The tunnel is connected and running. From now on it starts by itself with the computer.
```

### ب5. الرابط

بيسألك:
```
  Your link, e.g. https://amaorders.work (Enter to skip):
```
اكتب بالضبط **`https://amaorders.work`** ← Return.
بعدين:
```
  Restart the system now so it uses the link? (y/n):
```
اكتب **`y`** ← Return. النظام بيعيد تشغيل حاله (بيطلع كلام Stop وStart AMA) — استنى لحد ما يخلص.

### ب6. الفحص — شو لازم تشوف

بالآخر الأداة بتفحص كل شي لحالها. لازم تطلع كل الأسطر `OK`:
```
  OK   cloudflared is installed (2026.x.x ...)
  OK   The tunnel is connected on this computer
  OK   The tunnel is running
  OK   The system is running on this computer (port 6001)
  OK   APP_URL is https://amaorders.work
  OK   amaorders.work is managed by: kolton.ns.cloudflare.com, maleah.ns.cloudflare.com
  OK   amaorders.work has an address
  OK   https://amaorders.work reaches the system on this computer
  OK   http:// is sent on to https://

  Everything works. Staff can open https://amaorders.work from anywhere.
```
- إذا آخر سطر قبل الخلاصة طلع `!    http:// is NOT sent on to https://` ← اعمل [أ5](#أ5-always-use-https) وبعدين `4` مرة ثانية.
- أي سطر `XX`: تحته سهم `->` بيحكيلك شو تعمل، والشرح الكامل بـ [القسم 9](#9-شو-معنى-كل-سطر-بالفحص-الخيار-4).

اكبس Return بترجع للقائمة، و `0` للخروج. خلص — ما في إشي تاني على الماك.

### ب7. التأكد من برا

1. من **تلفون على الداتا** (مش على واي فاي الشركة): افتح `https://amaorders.work` ← لازم تطلع صفحة الدخول.
2. بموقع Cloudflare: **Networking** ← **Tunnels** ← النفق لازم يكون **HEALTHY**.

---

## 6. الجزء ج — على الويندوز، شاشة بشاشة

> اعمل هاد **بس** إذا النظام رح يشتغل على الويندوز بدل الماك. تذكّر: جهاز واحد بس.

### ج1. افتح الملف

1. افتح **File Explorer** ← مجلد المشروع `AMA-Order-System-Web`.
2. دبل كليك على **`Cloudflare AMA (Windows).cmd`**.
3. بينفتح شباك أسود. هاد طبيعي.

- إذا طلع **Windows protected your PC** (أزرق): **More info** ← **Run anyway**. (بس إذا المشروع منزّل zip من المتصفح.)
- إذا قال **Node.js is not installed**: نزّل LTS من [nodejs.org](https://nodejs.org) وركّبه.

### ج2. القائمة

اكبس جوّا الشباك الأسود، اكتب **`1`**، Enter.

### ج3. تركيب cloudflared (أوتوماتيك)

- **عن طريق winget** (موجود بويندوز 10 و11): بيكتب `Using winget...`، وبتشوف سطور تنزيل وتركيب.
- إذا winget مش موجود أو ما زبط: بينزّل المركّب الرسمي من Cloudflare (`cloudflared-windows-amd64.msi`) وبيركّبه.
- بالحالتين ممكن يطلع **سؤال ويندوز** (الشاشة بتغمق):
  **«Do you want to allow this app to make changes to your device?»** ← اكبس **Yes**.
  - إذا الحساب مش مدير، بيطلب اسم وكلمة سر حساب مدير.

لازم يطلع: `OK  cloudflared installed (2026.x.x ...)`.
(بينحط بـ `C:\Program Files (x86)\cloudflared\`.)

### ج4. لصق أمر التركيب

1. انسخ الأمر من Cloudflare ([أ3](#أ3-النفق-افتحه-وانسخ-أمر-التركيب)) — اختار **Windows**.
2. بالشباك الأسود عند `Paste:` ← **كبسة يمين بالماوس** (بتلصق فوراً) أو **Ctrl+V**.
3. Enter.
4. بيطلع **سؤال ويندوز** ← **Yes** (المرة هاي اسمه غالباً **Windows Command Processor**).

لازم يطلع: `OK  The tunnel is connected and running. ...`
- إذا كبست **No** بالغلط: بيقلك `You chose No at Windows' question - nothing was changed.` ← اختار `1` مرة ثانية واكبس Yes.

### ج5. الرابط والفحص

نفس الماك بالضبط ([ب5](#ب5-الرابط) و[ب6](#ب6-الفحص--شو-لازم-تشوف)): اكتب `https://amaorders.work` ← `y` ← استنى الفحص ← لازم `Everything works`.

---

## 7. الاستعمال اليومي

**ما في إشي تعمله.**

- النفق **خدمة**: بيشتغل لحاله مع الجهاز، حتى بعد انقطاع كهربا، حتى قبل ما حدا يسجّل دخول.
- النظام نفسه (Start AMA) بيرجع لحاله إذا مفعّل **Autostart AMA** والجهاز بيسجّل دخول لحاله (شوف ONLINE-ACCESS.md).
- إذا النت قطع: جوّا الشركة كل شي شغّال؛ الرابط الأونلاين بيرجع لحاله لما يرجع النت.

**إذا حسّيت في مشكلة:** Cloudflare AMA ← **`4`**، واقرأ الأسطر `XX`.

---

## 8. كل خيار بالقائمة بالتفصيل

| الرقم | شو بيعمل | متى | شو بيطلب منك |
|---|---|---|---|
| `1` Connect | بيركّب cloudflared إذا مش موجود، بيربط الجهاز بالنفق بالتوكن، بيحفظ الرابط بـ `server/.env`، وبيعمل فحص | أول مرة على أي جهاز | الأمر من Cloudflare، كلمة سر الماك / Yes بالويندوز، الرابط |
| `2` Start | بيشغّل النفق إذا كان موقّف | بعد `3` | كلمة سر الماك / Yes |
| `3` Stop | بيوقّف النفق: الرابط الأونلاين بيوقف، وجوّا الشركة كل شي شغّال | صيانة، أو قبل ما توقف النظام فترة | كلمة سر الماك / Yes |
| `4` Test | فحص كامل من أول السلسلة لآخرها، وتحت كل مشكلة شو تعمل | أي وقت | ولا إشي |
| `5` Log | آخر رسائل النفق (التوكن مخفي فيها دايماً) | إذا الفحص ما وضّح | ولا إشي |
| `6` Remove | بيشيل النفق من هالجهاز نهائياً (البرنامج cloudflared بيضل) | قبل النقل لجهاز ثاني، أو لربطه بنفق ثاني | `y` للتأكيد، كلمة سر / Yes |
| `7` Update | بيحدّث cloudflared لآخر نسخة وبيرجّع النفق يشتغل | كل كم شهر، أو إذا الفحص قال | كلمة سر / Yes |
| `0` Exit | خروج | | |

ملاحظات:
- **`3` Stop مش دائم**: مع أول إعادة تشغيل للجهاز النفق بيرجع يشتغل. للإيقاف الدائم: `6`.
- **سجل الويندوز (`5`)** فيه بس رسائل تشغيل/إيقاف الخدمة. إذا النفق **متصل** ولا لأ بتشوفه بموقع Cloudflare: **Networking ← Tunnels** ← لازم **HEALTHY**.
- **سجل الماك (`5`)** هو `/Library/Logs/com.cloudflare.cloudflared.err.log` — فيه كل شي.

---

## 9. شو معنى كل سطر بالفحص (الخيار 4)

`OK` = تمام. `XX` = مشكلة لازم تنحل. `!` = شغّال بس في شي يستاهل يتصلّح.

| السطر | إذا طلع `XX` أو `!` — شو تعمل |
|---|---|
| `cloudflared is installed` | `1` (بيركّبه). |
| `cloudflared is almost a year old` | `7`. Cloudflare بتدعم النسخ اللي عمرها أقل من سنة. |
| `The tunnel is connected on this computer` | `1` والصق الأمر. |
| `The tunnel service runs ..., which is no longer there` | البرنامج اللي الخدمة بتشغّله انمسح أو تغيّر مكانه. `6` ثم `1` (بتحتاج الأمر مرة ثانية: Overview ← Add a replica). |
| `The tunnel is running` / `is stopped` | `2`. |
| `The system is running on this computer (port 6001)` | **Start AMA**. وإذا قال `database is not ready`: Stop AMA ثم Start AMA، وشوف `.ama_runtime/server.log`. |
| `APP_URL is https://amaorders.work` | `1` بيسألك عنه، أو حطه بـ `server/.env`: `APP_URL=https://amaorders.work`، ثم Stop AMA وStart AMA. |
| `amaorders.work is managed by: ...cloudflare.com` | الـ nameservers عند GoDaddy لازم يكونوا تبع Cloudflare ([أ6](#أ6-للمرجع-نقل-الدومين-من-godaddy--خلصت)). |
| `amaorders.work has an address` | الطريق ناقص: [أ4](#أ4-الطرق-routes-الدومين--النظام). |
| `https://amaorders.work reaches the system on this computer` | ✅ هاد أهم سطر. |
| `... does not reach the system - ... error 530 / 1033` | ولا جهاز متصل بالنفق. إذا النفق هون **stopped**: `2`. إذا **not connected**: `1`. إذا **running** وبرضه 530: النت؟ جدار ناري بيمنع cloudflared (بورت **7844** طالع)؟ والطريق تابع **لنفس** النفق اللي ربطت فيه الجهاز؟ ← `5`. |
| `... error 502` | النفق تمام بس النظام طافي على الجهاز: **Start AMA**. |
| `... error 404` | ما في طريق لهالاسم: [أ4](#أ4-الطرق-routes-الدومين--النظام) (السهم بيكتبلك بالضبط شو تعبّي). |
| `... answers from ANOTHER computer` | ⚠️ النظام شغّال على جهازين! على واحد منهم: **Stop AMA** و `6`. |
| `... works, but it reaches another computer (nothing runs here)` | `!` — طبيعي إذا النظام قاصد يشتغل على الجهاز التاني. |
| `http:// is NOT sent on to https://` | `!` — [أ5](#أ5-always-use-https). |

---

## 10. رسائل الخطأ بالمتصفح

| شو بيطلع لما تفتح الرابط | معناه | الحل |
|---|---|---|
| صفحة Cloudflare: **Error 1033** (أو 530) | ولا جهاز متصل بالنفق | على جهاز النظام: Cloudflare AMA ← `4`، ثم `2` أو `1` |
| **Bad gateway — Error 502** | النفق شغّال بس النظام طافي | **Start AMA** على نفس الجهاز |
| **404** من Cloudflare | الرابط مش معرّف بالنفق | [أ4](#أ4-الطرق-routes-الدومين--النظام) |
| **This site can't be reached** / `DNS_PROBE_FINISHED_NXDOMAIN` | الاسم مش معروف | الطريق ناقص، أو الدومين مش Active ([أ2](#أ2-تأكد-إنو-الدومين-active)) |
| **Your connection is not private** | الشهادة لسا عم تنعمل (أول ربع ساعة بعد إضافة اسم جديد) | استنى 15 دقيقة. إذا ضلّت: احكي معي |
| صفحة الدخول بتفتح بس الدخول بيقول «محاولات كثيرة» | حماية تخمين كلمة السر | استنى 15 دقيقة |
| بالشركة شغّال، من برّا لأ | الرابط الأونلاين بس هو المشكلة | Cloudflare AMA ← `4` |

---

## 11. نقل الرابط من جهاز لجهاز

مثلاً من الويندوز للماك (أو العكس). **بالترتيب:**

1. **على الجهاز القديم**: صفحة المدير ← النسخ الاحتياطي ← **خذ نسخة احتياطية الآن**.
2. **على الجهاز القديم**: **Stop AMA**.
3. **على الجهاز القديم**: Cloudflare AMA ← **`6`** ← `y`. (هيك ما بيضل جهازين على نفس النفق.)
4. انسخ أحدث ملف من مجلد `backups` تبع الجهاز القديم لمجلد `backups` بالجهاز الجديد (USB، أو أي طريقة).
5. **على الجهاز الجديد**: **Restore AMA** ← اختار الملف ← اكتب `RESTORE` ← بعدين **Start AMA**.
6. **بموقع Cloudflare**: Networking ← Tunnels ← النفق ← **Overview** ← **Add a replica** ← اختار نظام **الجهاز الجديد** ← انسخ الأمر.
7. **على الجهاز الجديد**: Cloudflare AMA ← **`1`** ← الصق ← … ← لازم `Everything works`.

الرابط للموظفين **ما بيتغيّر**: `https://amaorders.work`.

> أي طلب بينعمل على الجهاز القديم **بعد** النسخة الاحتياطية ما بينتقل — فخذ النسخة ووقّف بنفس اللحظة.

---

## 12. التحديث

- **كل 3 شهور تقريباً**: Cloudflare AMA ← **`7`**.
  - إذا آخر نسخة: `OK  Already the newest version - nothing to do.`
  - غير هيك بينزّل الجديدة، بيركّبها، وبيرجّع النفق يشتغل. (ويندوز: سؤال Yes واحد. ماك: كلمة السر.)
- **الويندوز ما بيحدّث cloudflared لحاله أبداً** — فلا تنسى.
- الفحص (`4`) بينبّهك إذا النسخة قربت تصير عمرها سنة.

---

## 13. التوكن: سري — ولو انكشف

- التوكن هو الكود اللي بيبلّش بـ `eyJ` بأمر التركيب. **أي حدا معه بيقدر يربط جهازه بنفقك.**
- الأداة **ما بتطبعه ولا بتحفظه** — وإذا ظهر بسجل، بتخفيه (`eyJ...(hidden)`).
- **إذا انكشف** (انبعت لحدا، صورة شاشة، …):
  1. Cloudflare: Networking ← Tunnels ← النفق ← **Overview** ← **Refresh token**. (التوكن القديم ما عاد بيقدر يعمل اتصالات جديدة.)
  2. على جهاز النظام: Cloudflare AMA ← **`6`** ← `y`، بعدين **`1`** والصق **الأمر الجديد**.
  3. Cloudflare AMA ← `4` ← `Everything works`.

---

## 14. تركيب cloudflared باليد

بس إذا الخيار `1` قال `Could not install cloudflared automatically`. بعد ما تركّبه، اختار `1` مرة ثانية.

### الماك
- **مع Homebrew**: بالـ Terminal: `brew install cloudflared`
- **بدون Homebrew** — انسخ هالأسطر بالـ Terminal سطر سطر:
  - Apple silicon (M1/M2/M3/M4…):
    ```
    cd /tmp
    curl -L -o cloudflared.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz
    tar -xzf cloudflared.tgz
    sudo mkdir -p /usr/local/bin
    sudo install -m 755 cloudflared /usr/local/bin/cloudflared
    cloudflared --version
    ```
  - Intel: نفس الشي، بس بالسطر التاني `cloudflared-darwin-amd64.tgz`.
  - (بتعرف نوع الماك من: قائمة Apple ← About This Mac ← Chip: Apple = Apple silicon، Intel = Intel.)

### الويندوز
- نزّل: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi`
- دبل كليك عليه ← Yes. بيتركّب بـ `C:\Program Files (x86)\cloudflared\`.
- أو من Command Prompt: `winget install --id Cloudflare.cloudflared -e`

---

## 15. الأوامر اليدوية الكاملة (للفني)

إذا لأي سبب ما بدك تستعمل الأداة. `<TOKEN>` = التوكن كامل.

### الماك (Terminal)

| الشغلة | الأمر |
|---|---|
| تركيب الخدمة | `sudo cloudflared service install <TOKEN>` |
| إيقاف | `sudo launchctl bootout system/com.cloudflare.cloudflared` |
| تشغيل (بعد إيقاف) | `sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist` |
| إعادة تشغيل | `sudo launchctl kickstart -k system/com.cloudflare.cloudflared` |
| شغّال؟ | `pgrep -x cloudflared && echo running` |
| السجل | `tail -50 /Library/Logs/com.cloudflare.cloudflared.err.log` |
| إزالة | `sudo cloudflared service uninstall` — إذا فشلت (بعد إيقاف): شغّل أمر «تشغيل» أول، أو: `sudo launchctl bootout system/com.cloudflare.cloudflared; sudo rm -f /Library/LaunchDaemons/com.cloudflare.cloudflared.plist` |

### الويندوز (Command Prompt **as administrator**: ابحث عن cmd ← كبسة يمين ← Run as administrator)

| الشغلة | الأمر |
|---|---|
| تركيب الخدمة | `"C:\Program Files (x86)\cloudflared\cloudflared.exe" service install <TOKEN>` |
| إيقاف | `sc stop Cloudflared` |
| تشغيل | `sc start Cloudflared` |
| الحالة | `sc query Cloudflared` (لازم `RUNNING`) |
| إزالة | `"C:\Program Files (x86)\cloudflared\cloudflared.exe" service uninstall` |
| السجل | Event Viewer ← Windows Logs ← Application ← Source = **Cloudflared** |

بعد التركيب باليد، لازم كمان `APP_URL=https://amaorders.work` بملف `server/.env`، ثم Stop AMA وStart AMA.

---

## 16. أسئلة شائعة

**لازم الجهاز يضل شغّال 24 ساعة؟**
آه — الرابط بيشتغل بس والجهاز شغّال والنظام شغّال عليه. خلّيه موصول بالكهربا وما بينام ([القسم 3](#3-قبل-ما-تبلش)).

**بيكلّف إشي؟**
Cloudflare Tunnel مجاني. الكلفة الوحيدة تجديد الدومين عند GoDaddy كل سنة.

**لو انقطعت الكهربا؟**
لما يرجع الجهاز: النفق بيرجع لحاله. النظام بيرجع إذا مفعّل Autostart AMA والجهاز بيسجّل دخول لحاله.

**بقدر أخلّي الرابط يشتغل من الماك والويندوز مع بعض كاحتياط؟**
لأ — كل جهاز إله قاعدة بيانات لحاله، فبتصير الطلبات مقسومة بين جهازين. جهاز واحد بس.

**شو الفرق بين `3` و `6`؟**
`3` بيوقّف النفق لحد إعادة تشغيل الجهاز. `6` بيشيله من الجهاز نهائياً (للنقل).

**وين بشوف إنو كل شي تمام من برّا الشركة؟**
بموقع Cloudflare: Networking ← Tunnels ← **HEALTHY**. أو افتح الرابط من تلفون على الداتا.

**الموظفين شو بدهم يعملوا؟**
بس يفتحوا `https://amaorders.work`. ممكن يضيفوه للشاشة الرئيسية (شوف ONLINE-ACCESS.md، «للموظفين»).

**إذا علقت بخطوة؟**
Cloudflare AMA ← `4`، وابعتلي **الأسطر اللي فيها `XX`** (هاي ما فيها إشي سرّي). **ما تبعت التوكن أبداً.**
