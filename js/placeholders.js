// Ten photo slots. To add a real photo: drop the file in images/houses/ and set img, e.g. img: "images/houses/1.jpg".
// Real listings from Supabase fill the first slots automatically; empty slots stay as placeholders.
const SLOTS = [
  { title: "Bedsitter near the main gate", area: "Thogoto", rent: 6500, type: "Bedsitter", img: "" },
  { title: "Shared room, two sharing", area: "Kikuyu town", rent: 3500, type: "Shared", img: "" },
  { title: "Modern one bedroom", area: "Thogoto", rent: 12000, type: "1 bedroom", img: "" },
  { title: "Single room with WiFi", area: "Kamangu", rent: 5500, type: "Single room", img: "" },
  { title: "Two bedroom, sunny balcony", area: "Kikuyu town", rent: 18000, type: "2 bedroom", img: "" },
  { title: "Hostel bed, all bills paid", area: "Thogoto", rent: 4000, type: "Hostel", img: "" },
  { title: "Furnished studio", area: "Zambezi", rent: 9500, type: "Bedsitter", img: "" },
  { title: "Quiet single room", area: "Kamangu", rent: 5000, type: "Single room", img: "" },
  { title: "Shared apartment, 3 rooms", area: "Thogoto", rent: 4500, type: "Shared", img: "" },
  { title: "One bedroom with parking", area: "Kikuyu town", rent: 13500, type: "1 bedroom", img: "" },
];
const CAM = `<svg viewBox="0 0 24 24"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
function placeholderCard(s, i) {
  const photo = s.img
    ? `<div class="card-img" style="background-image:url('${encodeURI(s.img)}')" role="img" aria-label="${esc(s.title)}"></div>`
    : `<div class="card-img">${CAM}<span>Photo ${i + 1}</span></div>`;
  return `<article class="card ph">${photo}<div class="card-body"><div class="price">${formatKES(s.rent)} <small>/ month</small></div>
    <h3>${esc(s.title)}</h3><div class="meta">${esc(s.area)}</div><div><span class="tag">${esc(s.type)}</span></div>
    <a class="btn" href="listings.html">Browse houses</a></div></article>`;
}
