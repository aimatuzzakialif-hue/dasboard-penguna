const firebaseConfig = {
  apiKey: "ISI_PUNYAMU",
  authDomain: "ISI_PUNYAMU",
  databaseURL: "https://dasboard-penguna-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ISI_PUNYAMU",
  storageBucket: "ISI_PUNYAMU",
  messagingSenderId: "ISI_PUNYAMU",
  appId: "ISI_PUNYAMU"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const ref = db.ref("jadwal");

ref.on("value", (snapshot) => {
  const data = snapshot.val();
  tampilkanData(data);
});

// Fungsi ini di-override di index.html untuk tampilan yang lebih baik
function tampilkanData(data) {
  const container = document.getElementById("jadwal");
  container.innerHTML = "";

  if (!data) {
    container.innerHTML = "Tidak ada data";
    return;
  }

  for (let id in data) {
    const item = data[id];
    container.innerHTML += `
      <div>
        <b>${item.jam}</b> - ${item.dari} ke ${item.tujuan}
        <br>Status: ${item.status}
      </div>
      <hr>
    `;
  }
}