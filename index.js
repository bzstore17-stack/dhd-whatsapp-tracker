const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// تحميل الإعدادات
const config = require('./config.json');

// ملف لتخزين الطلبيات التي تم إرسال إشعارات لها منعاً للتكرار
const SENT_LOG_FILE = path.join(__dirname, 'sent_orders.json');

function getSentOrders() {
    if (fs.existsSync(SENT_LOG_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SENT_LOG_FILE, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

function saveSentOrder(trackingCode, messageType) {
    const sent = getSentOrders();
    const key = `${trackingCode}_${messageType}`;
    if (!sent.includes(key)) {
        sent.push(key);
        fs.writeFileSync(SENT_LOG_FILE, JSON.stringify(sent, null, 2));
    }
}

function isOrderSent(trackingCode, messageType) {
    const sent = getSentOrders();
    const key = `${trackingCode}_${messageType}`;
    return sent.includes(key);
}

// تحويل الأرقام الجزائرية للصيغة الدولية مع رمز الواتساب @c.us
function formatWhatsAppNumber(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('0')) {
        clean = '213' + clean.substring(1);
    } else if (!clean.startsWith('213')) {
        clean = '213' + clean;
    }
    return `${clean}@c.us`;
}

// إعداد خيارات Puppeteer المتوافقة مع السيرفر السحابي (Render / Linux / Docker)
const puppeteerArgs = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
    ]
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerArgs.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

// إنشاء كائن الواتساب
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "dhd-session"
    }),
    puppeteer: puppeteerArgs
});

client.on('qr', (qr) => {
    console.log('\n==================================================');
    console.log('📱 امسح رمز الـ QR التالي باستخدام واتساب هاتفك (0673789179):');
    console.log('==================================================\n');
    qrcode.generate(qr, { small: true });
});

let lastCheckedMinute = "";
let cachedOrders = [];

client.on('ready', async () => {
    console.log('\n✅ تم الاتصال بنجاح بـ واتساب الرقم (0673789179)!');
    console.log(`⏰ الأوقات المحددة للفحص اليومي والتقرير هي: ${config.scheduled_times.join(' - ')}`);

    console.log('\n🔄 جاري فحص طلبيات منصة DHD Express الحقيقية الآن...\n');
    checkDhdOrders();

    setInterval(() => {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${hours}:${minutes}`;

        if (config.scheduled_times.includes(currentTime) && lastCheckedMinute !== currentTime) {
            lastCheckedMinute = currentTime;
            console.log(`\n⏰ حان الوقت المجدول (${currentTime})! جاري فحص ومعالجة طلبيات DHD Express...`);
            checkDhdOrders();
        }
    }, 30000);
});

// 💬 الميزة 3: الرد التلقائي الآلي على أسئلة الزبائن
client.on('message', async (msg) => {
    try {
        const text = (msg.body || '').toLowerCase().trim();
        const isTrackingQuery = 
            text.includes('تتبع') || 
            text.includes('فين') || 
            text.includes('وين') || 
            text.includes('طلبيتي') || 
            text.includes('شحال') || 
            text.includes('وصلت');

        if (isTrackingQuery && cachedOrders.length > 0) {
            const userOrder = cachedOrders.find(o => {
                const p = String(o.telephone || o.telephone_2 || '');
                return p && formatWhatsAppNumber(p) === msg.from;
            });

            if (userOrder) {
                const trackingCode = userOrder.tracking || userOrder.reference;
                const subState = userOrder.current_sub_state;
                const isPostponed = !!userOrder.postponed_to;
                
                let statusText = 'على قيد التوصيل';
                if (subState === 5) statusText = 'تم التسليم بنجاح (Livré)';
                else if (isPostponed) statusText = `مؤجلة ليوم ${userOrder.postponed_to}`;
                else if (userOrder.stop_desk === 1) statusText = 'متوفرة في المكتب';

                const city = userOrder.wilaya || userOrder.commune || '';
                const price = userOrder.total_paid || userOrder.price || 0;

                const replyMsg = 
`أهلاً بك! 👋

📋 حالة طلبك الحالية هي: *${statusText}*
📦 رقم التتبع: *${trackingCode}*
📍 المدينة: ${city}
💰 المبلغ: ${price} دج

يسعدنا دائماً خدمتك! 💚`;

                await msg.reply(replyMsg);
                console.log(`🤖 💬 تم الرد الآلي التلقائي على الزبون: ${msg.from}`);
            }
        }
    } catch (e) {
        console.error("خطأ في الرد الآلي:", e.message);
    }
});

// فحص طلبيات DHD Express الدقيق
async function checkDhdOrders() {
    console.log(`[${new Date().toLocaleTimeString()}] 🔍 جاري اتصال وطلب بيانات منصة DHD Express...`);

    if (!config.dhd_api_token) {
        console.log("⚠️ يرجى إضافة مفتاح DHD API Token في ملف config.json أولاً.");
        return;
    }

    try {
        const response = await axios.post(config.dhd_api_url, {}, {
            headers: {
                'Authorization': `Bearer ${config.dhd_api_token}`,
                'Accept': 'application/json'
            }
        });

        const orders = response.data.data || response.data || [];
        cachedOrders = Array.isArray(orders) ? orders : [];
        
        console.log(`📦 إجمالي الطلبيات المسحوبة من منصة DHD: ${cachedOrders.length}`);

        let countHomeDelivery = 0;
        let countDeskDelivery = 0;
        let countDelivered = 0;
        let countPostponed = 0;
        let totalRevenue = 0;
        let countNoAnswerAlerts = 0;
        let countReviewSent = 0;
        let countRetourRescued = 0;

        for (const order of cachedOrders) {
            const trackingCode = String(order.tracking || order.reference || '');
            const customerName = String(order.nom_client || 'الزبون المحترم').trim();
            const customerPhone = order.telephone || order.telephone_2;
            const city = order.wilaya || order.commune || 'مدينتك';
            const price = parseFloat(order.total_paid || 0) || 0;

            const isStopDesk = order.stop_desk === 1; // 1 = مكتب، 0 = منزل
            const subState = order.current_sub_state;
            const isPostponed = !!order.postponed_to; // مؤجلة ليوم آخر
            const isReturn = order.is_return === 1 || String(order.status || '').includes('retour');

            // بيانات الليفروغ/الموزع من DHD
            const driverName = order.driver_name;
            const driverPhone = order.driver_phone;
            const driverPhoneLine = driverPhone ? `👤 الموزع: *${driverName || 'المندوب'}*\n📞 هاتف الموزع: *${driverPhone}*\n` : '';

            // بيانات المكتب ورابط غوغل ماب
            const deskInfo = order.desk_details || {};
            const officeAddress = deskInfo.hub_location_adresse || `مكتب DHD Express بـ ${city}`;
            const officePhone = deskInfo.hub_location_phone || driverPhone;
            const officeMapsLink = deskInfo.hub_location_map || `https://www.google.com/maps/search/DHD+Express+${encodeURIComponent(city)}`;
            const officePhoneLine = officePhone ? `📞 هاتف المكتب للتواصل: *${officePhone}*\n` : '';

            // 1️⃣ الطلبيات الحقيقية المسلمة بنجاح فقط (SubState = 5 أو Livré مؤكد وبدون تأجيل)
            const isStrictlyDelivered = (subState === 5 || String(order.status || '').includes('livré')) && !isPostponed && !isReturn;
            
            if (isStrictlyDelivered) {
                countDelivered++;
                totalRevenue += price;

                if (!isOrderSent(trackingCode, 'REVIEW')) {
                    countReviewSent++;
                    const reviewMsg = 
`مرحباً ${customerName} 👋

🎉 تم تسليم طلبيتك رقم *${trackingCode}* بنجاح!

نتمنى أن تكون الطلبية والخدمة قد نالت إعجابك 💚
كيف كانت تجربتك معنا؟ ⭐⭐⭐⭐⭐

إذا كان لديك أي استفسار أو ملحوظة، يسعدنا تواصلك معنا دائماً!
شكراً لاختياركم متجرنا 🛍️`;

                    if (customerPhone) {
                        const waId = formatWhatsAppNumber(customerPhone);
                        if (waId) await client.sendMessage(waId, reviewMsg);
                        console.log(`🌟 ✅ تم إرسال طلب [التقييم ورأي الزبون]: ${customerName} (${customerPhone}) - ${trackingCode}`);
                    }
                    saveSentOrder(trackingCode, 'REVIEW');
                }
            }

            // 2️⃣ الطلبيات المؤجلة (Postponed)
            if (isPostponed && !isStrictlyDelivered && !isReturn) {
                countPostponed++;
            }

            // 3️⃣ 🚨 إنقاذ الروتور (إلغاء أو رجوع)
            if (isReturn || order.cancel_reason) {
                countRetourRescued++;
                if (!isOrderSent(trackingCode, 'RETOUR_RESCUE')) {
                    const myWaId = formatWhatsAppNumber(config.my_phone_number);
                    const rescueMsg = 
`🚨 *تنبيه عاجل لإنقاذ طلبية (Retour Rescue)*

الطلبية رقم *${trackingCode}* دخلت حالة إلغاء/مرتجعة!
👤 الزبون: *${customerName}*
📞 هاتف الزبون: *${customerPhone}*
📍 المدينة: ${city}
💰 المبلغ: ${price} دج
⚠️ السبب: ${order.cancel_reason || 'غير محدد'}

يرجى الاتصال بالزبون فوراً على الرقم أعلاه لمعرفة السبب وإنقاذ الطلبية قبل إعادتها للمصدر!`;

                    await client.sendMessage(myWaId, rescueMsg);
                    console.log(`🚨 ✅ تم إرسال تنبيه [إنقاذ الروتور] على واتسابك للطلبية: ${trackingCode}`);
                    saveSentOrder(trackingCode, 'RETOUR_RESCUE');
                }
            }

            // 4️⃣ حالات التوصيل للمكتب (Stop Desk = 1)
            if (isStopDesk && !isStrictlyDelivered && !isReturn) {
                countDeskDelivery++;
                if (!isOrderSent(trackingCode, 'DESK')) {
                    const customerMsg = 
`مرحباً ${customerName} 👋

🏢 طلبيتك رقم *${trackingCode}* وصلت وهي الآن متوفرة في *مكتب DHD Express*!

📍 عنوان المكتب: *${officeAddress}*
🗺️ موقع المكتب على الخريطة (Google Maps):
${officeMapsLink}

${officePhoneLine}💰 المبلغ المستحق: ${price} دج

يرجى التوجه إلى عنوان المكتب الموضح أعلاه لاستلام طلبيتك.
شكراً لثقتكم بنا 💚`;

                    if (customerPhone) {
                        const waId = formatWhatsAppNumber(customerPhone);
                        if (waId) await client.sendMessage(waId, customerMsg);
                        console.log(`🏢 ✅ تم إرسال رسالة المكتب مع [رابط الخريطة] للزبون: ${customerName} (${customerPhone})`);
                    }
                    saveSentOrder(trackingCode, 'DESK');
                }

            // 5️⃣ حالات التوصيل للمنزل (Stop Desk = 0) ومزالت على قيد التوصيل
            } else if (!isStopDesk && (subState === 2 || subState === 4 || subState === 1) && !isStrictlyDelivered && !isReturn) {
                countHomeDelivery++;
                if (!isOrderSent(trackingCode, 'HOME')) {
                    const customerMsg = 
`مرحباً ${customerName} 👋

🚗 طلبيتك رقم *${trackingCode}* هي الآن *على قيد التوصيل إلى منزلك* مع موزع شركة DHD Express!

${driverPhoneLine}📍 الولاية/المدينة: ${city}
💰 المبلغ المستحق: ${price} دج

يرجى التواصل مع الموزع وإبقاء الهاتف قريباً منكم لاستلام الطلبية.
شكراً لثقتكم بنا 💚`;

                    if (customerPhone) {
                        const waId = formatWhatsAppNumber(customerPhone);
                        if (waId) await client.sendMessage(waId, customerMsg);
                        console.log(`🚗 ✅ تم إرسال رسالة [توصيل المنزل] للزبون: ${customerName} (${customerPhone}) - رقم الموزع: ${driverPhone || 'بدون'}`);
                    }
                    saveSentOrder(trackingCode, 'HOME');
                }
            }
        }

        console.log('\n==================================================');
        console.log(`📊 [تقرير منصة DHD Express - ${new Date().toLocaleTimeString()}]`);
        console.log(`📦 إجمالي الطلبيات المسحوبة: ${cachedOrders.length}`);
        console.log(`✔️ المسلمة المؤكدة (Livré): ${countDelivered} | الأرباح: ${totalRevenue.toLocaleString()} DA`);
        console.log(`🚗 على قيد التوصيل للمنزل: ${countHomeDelivery} | 🏢 بالمكتب: ${countDeskDelivery}`);
        console.log(`⏳ الطلبيات المؤجلة: ${countPostponed}`);
        console.log(`🚨 تنبيهات إنقاذ الروتور: ${countRetourRescued} | ⚠️ تنبيهات عدم الرد: ${countNoAnswerAlerts}`);
        console.log('==================================================\n');

        // التقرير اليومي المالي الملخص لواتسابك (0673789179)
        const myWaId = formatWhatsAppNumber(config.my_phone_number);
        const reportMsg = 
`📊 *التقرير اليومي المالي لطلبيات DHD Express*

✔️ إجمالي الطلبيات المسلمة (Livré): *${countDelivered}*
💰 المبالغ المالية المحصلة: *${totalRevenue.toLocaleString()} دج*

📦 إجمالي الطلبيات بالحساب: *${cachedOrders.length}*
🚗 على قيد التوصيل للمنزل: *${countHomeDelivery}*
🏢 متوفرة في المكتب للاستلام: *${countDeskDelivery}*
⏳ المؤجلة ليوم آخر: *${countPostponed}*
🚨 تنبيهات إنقاذ الروتور: *${countRetourRescued}*

⏰ الوقت: ${new Date().toLocaleTimeString()} - ${new Date().toLocaleDateString()}`;

        await client.sendMessage(myWaId, reportMsg);

    } catch (error) {
        console.error("❌ خطأ أثناء الاتصال بـ DHD API:", error.message);
    }
}

// بدء التشغيل
client.initialize();
