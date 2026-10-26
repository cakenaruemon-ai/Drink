/* ตั้งค่าการเชื่อมต่อ Supabase (ดูวิธีหาค่าในไฟล์ อ่านก่อน_วิธีติดตั้ง.txt ขั้นที่ 4)
   ค่า anon key เปิดเผยได้ตามที่ Supabase ออกแบบไว้ ข้อมูลถูกป้องกันด้วยการล็อกอิน + Row Level Security */
window.APP_CONFIG = {
  SUPABASE_URL: "ใส่ Project URL ตรงนี้",          // เช่น https://abcdefghijk.supabase.co
  SUPABASE_ANON_KEY: "ใส่ anon public key ตรงนี้",  // ขึ้นต้นด้วย eyJ...
};
