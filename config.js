/* ตั้งค่าการเชื่อมต่อ Supabase (ดูวิธีหาค่าในไฟล์ อ่านก่อน_วิธีติดตั้ง.txt ขั้นที่ 4)
   ค่า anon key เปิดเผยได้ตามที่ Supabase ออกแบบไว้ ข้อมูลถูกป้องกันด้วยการล็อกอิน + Row Level Security */
window.APP_CONFIG = {
  SUPABASE_URL: "https://pckqynxeqhsqrexclbob.supabase.co",          // เช่น https://abcdefghijk.supabase.co
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBja3F5bnhlcWhzcXJleGNsYm9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMDM0MTgsImV4cCI6MjEwODU3OTQxOH0.Tk84OMzhHmMDhMHckztuHKgKXWJJhBSE30JxqhwTSI0",  // ขึ้นต้นด้วย eyJ...
};
