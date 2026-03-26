// seed-runners.mjs
// รัน: node seed-runners.mjs
// ต้องกรอก config ด้านล่างก่อน

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, Timestamp } from 'firebase/firestore';

// ── กรอก Firebase config เดิม ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCz19FWvCVIcC8jDIPPhFQmlkIRzW6LRqQ",
  authDomain:        "teamliverunningtracker.firebaseapp.com",
  projectId:         "teamliverunningtracker",
  storageBucket:     "teamliverunningtracker.firebasestorage.app",
  messagingSenderId: "186533162472",
  appId:             "1:186533162472:web:a6e5d075e2dc516a84885d",
};

// ── ตั้งค่า Event ─────────────────────────────────────────────────────────
const EVENT_ID = "TEST001";

// ── กลุ่มนักวิ่งจำลอง ────────────────────────────────────────────────────
// ศูนย์กลางที่กรุงเทพฯ (สวนลุมพินี)
const CENTER_LAT = 13.7294;
const CENTER_LNG = 100.5418;

const NAMES = [
  "สมชาย ใจดี", "สมหญิง รักวิ่ง", "วิชัย เร็วมาก", "นิดา สู้ชีวิต",
  "ประเสริฐ วิ่งไว", "มาลี สดใส", "ธนา แข็งแกร่ง", "พิมพ์ใจ มุ่งมั่น",
  "อานนท์ ไม่ยอมแพ้", "รัตนา ก้าวหน้า", "ชัยวัฒน์ ฝึกหนัก",
  "สุดา ไม่หยุด", "ภานุ วิ่งสู้", "จิรา ตั้งใจ", "เอกชัย เดินหน้า",
  "นภา บินได้", "กิตติ สุขภาพดี", "วันดี มีพลัง", "ศักดิ์ดา ไม่ถอย",
  "ลัดดา วิ่งเพลิน",
];

// สร้างตำแหน่งแบบกระจายตามเส้นทางวิ่งจำลอง
function mockPosition(index, total) {
  // กระจายนักวิ่งตาม "เส้นทาง" จาก start ถึง finish
  const progress = index / total; // 0.0 - 1.0

  // เส้นทางวนรอบสวนลุมพินี (จำลอง)
  const angle = progress * Math.PI * 2;
  const radiusLat = 0.015;
  const radiusLng = 0.020;

  // เพิ่ม noise เล็กน้อยให้ดูเป็นธรรมชาติ
  const noise = () => (Math.random() - 0.5) * 0.002;

  return {
    lat: CENTER_LAT + Math.sin(angle) * radiusLat + noise(),
    lng: CENTER_LNG + Math.cos(angle) * radiusLng + noise(),
  };
}

// กำหนด status จำลอง
function mockStatus(index) {
  if (index === 3)  return 'sos';        // คนที่ 4 กด SOS
  if (index === 7)  return 'stationary'; // คนที่ 8 หยุดนิ่ง
  if (index === 12) return 'stationary'; // คนที่ 13 หยุดนิ่ง
  if (index === 15) return 'inactive';   // คนที่ 16 สัญญาณหาย
  return 'running';
}

// คำนวณเวลา updatedAt (คนสัญญาณหายให้เวลาเก่ากว่า 20 นาที)
function mockUpdatedAt(status) {
  const now = Date.now();
  if (status === 'inactive') {
    return Timestamp.fromMillis(now - 25 * 60 * 1000); // 25 นาทีที่แล้ว
  }
  if (status === 'stationary') {
    return Timestamp.fromMillis(now - 12 * 60 * 1000); // 12 นาทีที่แล้ว
  }
  // active: อัพเดทล่าสุด 30 วินาทีที่แล้ว
  return Timestamp.fromMillis(now - 30 * 1000);
}

async function seedRunners() {
  const app = initializeApp(firebaseConfig);
  const db  = getFirestore(app);

  console.log(`🌱 กำลังใส่ข้อมูลนักวิ่งจำลอง ${NAMES.length} คน...`);
  console.log(`   Event: ${EVENT_ID}\n`);

  for (let i = 0; i < NAMES.length; i++) {
    const pos    = mockPosition(i, NAMES.length);
    const status = mockStatus(i);
    const userId = `mock_user_${String(i + 1).padStart(3, '0')}`;

    const data = {
      userId,
      displayName: NAMES[i],
      bibNumber:   `A${String(i + 1).padStart(3, '0')}`,
      teamId:      `team_${Math.floor(i / 5) + 1}`,
      lat:         pos.lat,
      lon:         pos.lng,
      distance:    Math.round((1 - i / NAMES.length) * 10000), // meters (คนนำวิ่งมากกว่า)
      speed:       status === 'running' ? 2.5 + Math.random() * 1.5 : 0, // m/s
      heading:     Math.random() * 360,
      status,
      updatedAt:   mockUpdatedAt(status),
    };

    await setDoc(
      doc(db, 'events', EVENT_ID, 'liveLocations', userId),
      data
    );

    const icon = status === 'sos' ? '🔴' : status === 'stationary' ? '🟡' : status === 'inactive' ? '⚪' : '🟢';
    console.log(`  ${icon} ${data.bibNumber} ${NAMES[i].padEnd(20)} status: ${status}`);
  }

  console.log(`\n✅ เสร็จแล้ว! เปิด browser แล้ว refresh dashboard ได้เลยครับ`);
  process.exit(0);
}

seedRunners().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
