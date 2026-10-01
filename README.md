# 🚀 خطوات تشغيل برنامج ربط DHD Express مع واتساب (0673789179)

---

### 1️⃣ الخطوة الأولى: تثبيت المكتبات اللازمة
افتح **PowerShell** أو **Command Prompt** ونفذ الأمر التالي:

```powershell
cd "C:\Users\ASUS\Desktop\BZ STORE\dhd-whatsapp-tracker"
npm install
```

---

### 2️⃣ الخطوة الثانية: وضع مفتاح DHD API
افتح الملف:
[`C:\Users\ASUS\Desktop\BZ STORE\dhd-whatsapp-tracker\config.json`](file:///C:/Users/ASUS/Desktop/BZ%20STORE/dhd-whatsapp-tracker/config.json)

ضع فيه مفتاح الـ API الخاص بحسابك من منصة DHD Express:
```json
{
  "dhd_api_token": "ضع_مفتاح_DHD_هنا",
  "dhd_api_url": "https://api.dhdexpress.com/v1/parcels",
  "my_phone_number": "213673789179",
  "check_interval_minutes": 5
}
```

---

### 3️⃣ الخطوة الثالثة: تشغيل البرنامج ومسح كود الـ QR
شغّل البرنامج بالأمر التالي:

```powershell
npm start
```

1. سيظهر لك **رمز QR** على الشاشة.
2. افتح تطبيق الواتساب في هاتفك **0673789179**.
3. اذهب إلى: **الإعدادات > الأجهزة المرتبطة > ربط جهاز** واكتسح الرمز (QR Code).

---

### 🟢 ما الذي سيحدث الآن؟
* بمجرد مسح الرمز، سيتصل هاتف **0673789179** بالنظام بصورة دائمة.
* كل **5 دقائق** يقرأ النظام الحساب في **DHD Express**.
* أي طلبية تصبح **"على قيد التوصيل"**:
  1. يرسل رسالة فورية للزبون تخبره بأن طلبيته في الطريق والمبلغ المطلوب للتحضير.
  2. يرسل لك إشعاراً تلخيصياً على الواتساب الخاص بك **0673789179**.
