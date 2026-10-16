import "dotenv/config";
import { 
    InlineKeyboard,
    Bot,
    session,
    Keyboard
 } from "grammy";
 
 import type { Context, SessionFlavor } from "grammy";

 import { calculateCleaningPrice} from "./pricing.js"

interface SessionData {
    selectedService: "maintenance_cleaning" | "deep_cleaning" | null;
    step: "idle" | "awaiting_area" | "awaiting_name" | "awaiting_phone" | "awaiting_date";
    area: number | null;
    name: string | null;
    phone: string | null;
    desiredDate: string | null;
}

const contactKeyboard = new Keyboard()
    .requestContact("Отправить телефон")
    .resized()
    .oneTime();

 const token = process.env.BOT_TOKEN;

if(!token) {throw new Error("Токен бота не найден!");}

type MyContext = Context & SessionFlavor<SessionData>;
const bot = new Bot<MyContext>(token)

bot.use(session({
    initial: (): SessionData => ({
        selectedService: null,
        step: "idle",
        area: null,
        name: null,
        phone: null,
        desiredDate: null

    })
}));

const keyboard = new InlineKeyboard()
.text("Поддерживающая уборка", "maintenance_cleaning")
.row()
.text("Генеральная уборка", "deep_cleaning");

bot.command("start", async(ctx) =>{
    ctx.session.step = "idle";
    ctx.session.selectedService = null;
    ctx.session.area = null;
    ctx.session.name = null;
    ctx.session.phone = null;
    ctx.session.desiredDate = null;
    await ctx.reply("Добро пожаловать в Zaynest!");
    await ctx.reply("Выберите услугу:", {reply_markup: keyboard,});
});

bot.command("cancel", async (ctx) => {
    ctx.session.step = "idle";
    ctx.session.selectedService = null;
    ctx.session.area = null;
    ctx.session.name = null;
    ctx.session.phone = null;
    ctx.session.desiredDate = null;

    await ctx.reply("Оформление отменено. Выберите услугу", {
        reply_markup: keyboard,});
});

bot.callbackQuery("maintenance_cleaning", async (ctx) => {
    ctx.session.step = "awaiting_area";
    ctx.session.selectedService = "maintenance_cleaning";

    await ctx.answerCallbackQuery();
    await ctx.reply(`Укажите площадь квартиры`);
});

bot.callbackQuery("deep_cleaning", async (ctx) => {
    ctx.session.step = "awaiting_area";
    ctx.session.selectedService = "deep_cleaning";
    await ctx.answerCallbackQuery();

    await ctx.reply('Укажите площадь квартиры\n')});

bot.on("message:text", async(ctx) => {
    if(ctx.session.step === "awaiting_area"){
        const service = ctx.session.selectedService

        if(service === null){await ctx.reply("Нужно выбрать услугу");return;}

        let price: number;

        if(service === "maintenance_cleaning") {price = 80;} else {price = 150;}
        const area =  Number(ctx.message.text);

        if(!Number.isInteger(area) || area <=0 || area > 1000) {
            await ctx.reply("Введите корректную площадь.");return;}

        ctx.session.area = area;
        ctx.session.step = "awaiting_name"

        await ctx.reply(`Предварительная стоимость: ${calculateCleaningPrice(area, price)}`)
        await ctx.reply("Как вас зовут?");
        return
    }

    if(ctx.session.step === "awaiting_name"){
        const name = ctx.message.text.trim();

        if(name.length < 2 || name.length > 50) {
            await ctx.reply("Введите корректное имя");return}

        ctx.session.name = name;
        await ctx.reply(`Спасибо, ${name}`)

        ctx.session.step = "awaiting_phone";
        await ctx.reply(`Отправьте свой номер телефона:`, {reply_markup: contactKeyboard});
        return
    }

    if(ctx.session.step === "awaiting_phone") {
        const phone  = ctx.message.text.trim().replace(/[\s()-]/g, "");


        const phonePattern = /^\+?\d{10,15}$/;

        const isValid = phonePattern.test(phone);

        if(!isValid) { await ctx.reply(`Введите корректный номер телефона:`);return}

        ctx.session.phone = phone;

        await ctx.reply("Номер телефона сохранен!", {
        reply_markup: { remove_keyboard: true }
        });
        ctx.session.step = "awaiting_date";

        await ctx.reply("Укажите желаемую дату и время уборки в формате ДД.ММ.ГГГГ ЧЧ:ММ");
        return
    }

    if(ctx.session.step === "awaiting_date") {
        const date = ctx.message.text.trim()
        const datePattern = /^\d{2}\.\d{2}\.\d{4}\ \d{2}\:\d{2}$/;

        const isValid = datePattern.test(date);

        if(!isValid) { await ctx.reply(`Введите дату в формате ДД.ММ.ГГГГ ЧЧ:ММ`
        );
        return};

        const parts = date.split(" ");
        const datePart = parts[0];
        const timePart = parts[1];

        if(!datePart) { return;}
        if(!timePart) { return;}

        const dateParts = datePart.split(".");

        const day = Number(dateParts[0]);
        const month = Number(dateParts[1]);
        const year = Number(dateParts[2]);

        const timeParts = timePart.split(":");
        const hours = Number(timeParts[0]);
        const minutes = Number(timeParts[1]);

        if(hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || day < 1 || day >31 || month < 1 || month > 12) {
            await ctx.reply(`Введите корректную дату и время`);
            return};

        const daysInMonth = new Date(year, month, 0).getDate();

        if(day > daysInMonth) { await ctx.reply(`Такой даты не существует`);
            return}

        const selectedDate = new Date(year, month - 1, day, hours, minutes)
        const now = new Date();

        if(selectedDate <= now) { await ctx.reply(`Укажите будущую дату и время!`);
            return}

        ctx.session.desiredDate = date;

        await ctx.reply(`Желаемая дата уборки сохранена: ${date}`);

        ctx.session.step = "idle";
        
        return;
    }

    
});


bot.on("message:contact", async (ctx) => {
    if(ctx.session.step === "awaiting_phone"){

        const contact = ctx.message.contact;
        const phone = contact.phone_number;

        if(contact.user_id !== ctx.from.id){
            await ctx.reply("Отправьте свой собственный контакт");return}

        ctx.session.phone = phone;

        await ctx.reply("Номер телефона сохранен!", {
        reply_markup: { remove_keyboard: true }
        });

        ctx.session.step = "awaiting_date";

        await ctx.reply("Укажите желаемую дату и время уборки в формате ДД.ММ.ГГГГ ЧЧ:ММ");

        return

    }

    
})


bot.start();