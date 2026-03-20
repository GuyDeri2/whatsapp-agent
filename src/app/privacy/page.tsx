import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "מדיניות פרטיות — סוכן ווטסאפ",
};

export default function PrivacyPolicy() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "2rem 1.5rem",
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.8,
        color: "#e0e0e0",
      }}
    >
      <h1>מדיניות פרטיות</h1>
      <p>
        <strong>עדכון אחרון:</strong> 20 במרץ 2026
      </p>

      <h2>1. כללי</h2>
      <p>
        שירות &quot;סוכן ווטסאפ&quot; (להלן: &quot;השירות&quot;) מופעל על ידי
        Guy Deri (להלן: &quot;אנחנו&quot;). מדיניות פרטיות זו מתארת כיצד אנו
        אוספים, משתמשים ומגנים על המידע שלך בעת השימוש בשירות.
      </p>

      <h2>2. מידע שאנו אוספים</h2>
      <ul>
        <li>
          <strong>פרטי חשבון:</strong> כתובת דואר אלקטרוני, שם העסק, ומספר
          טלפון WhatsApp שחיברת.
        </li>
        <li>
          <strong>הודעות WhatsApp:</strong> הודעות שמתקבלות ונשלחות דרך השירות
          נשמרות כדי לספק תשובות AI ולהציגן בדשבורד.
        </li>
        <li>
          <strong>טוקנים של Meta:</strong> אסימוני גישה (access tokens) של
          WhatsApp Cloud API נשמרים בצורה מאובטחת בשרת כדי לאפשר שליחה וקבלה של
          הודעות.
        </li>
      </ul>

      <h2>3. כיצד אנו משתמשים במידע</h2>
      <ul>
        <li>לספק את שירות הסוכן האוטומטי — קבלת הודעות WhatsApp ומענה באמצעות AI.</li>
        <li>להציג היסטוריית שיחות בדשבורד העסקי.</li>
        <li>לשפר את השירות ולפתור בעיות טכניות.</li>
      </ul>

      <h2>4. שיתוף מידע עם צדדים שלישיים</h2>
      <p>אנו משתמשים בשירותים הבאים:</p>
      <ul>
        <li>
          <strong>Meta (WhatsApp Cloud API)</strong> — לשליחה וקבלה של הודעות
          WhatsApp.
        </li>
        <li>
          <strong>Supabase</strong> — לאחסון נתונים מאובטח (בסיס נתונים, אימות
          משתמשים).
        </li>
        <li>
          <strong>DeepSeek</strong> — ליצירת תשובות AI. תוכן ההודעות מועבר ל-API
          של DeepSeek לצורך יצירת תגובה.
        </li>
        <li>
          <strong>Vercel</strong> — לאירוח האפליקציה.
        </li>
      </ul>
      <p>לא נמכור את המידע שלך לצדדים שלישיים.</p>

      <h2>5. אבטחת מידע</h2>
      <p>
        אנו מיישמים אמצעי אבטחה סבירים להגנה על המידע שלך, כולל הצפנת תעבורה
        (HTTPS), הפרדת נתונים בין לקוחות (multi-tenant isolation), ואימות חתימות
        webhook.
      </p>

      <h2>6. שמירת מידע</h2>
      <p>
        הנתונים שלך נשמרים כל עוד חשבונך פעיל. ניתן לבקש מחיקת כל הנתונים על
        ידי פנייה אלינו.
      </p>

      <h2>7. מחיקת נתונים</h2>
      <p>
        בהתאם לדרישות Meta, ניתן לבקש מחיקת כל הנתונים הקשורים לחשבון Facebook
        שלך ולשימוש ב-WhatsApp דרך השירות. לבקשת מחיקה, פנה אלינו בכתובת:{" "}
        <a href="mailto:guyderi97@gmail.com" style={{ color: "#4fc3f7" }}>
          guyderi97@gmail.com
        </a>
      </p>

      <h2>8. זכויות המשתמש</h2>
      <p>יש לך זכות:</p>
      <ul>
        <li>לגשת למידע שנאסף עליך.</li>
        <li>לבקש תיקון או מחיקה של המידע.</li>
        <li>לנתק את חשבון ה-WhatsApp בכל עת דרך הדשבורד.</li>
      </ul>

      <h2>9. יצירת קשר</h2>
      <p>
        לשאלות בנוגע למדיניות פרטיות זו, ניתן לפנות אלינו:{" "}
        <a href="mailto:guyderi97@gmail.com" style={{ color: "#4fc3f7" }}>
          guyderi97@gmail.com
        </a>
      </p>
    </main>
  );
}
