// =============================================
//  FIREBASE CONFIGURATION
// =============================================
const firebaseConfig = {
  apiKey: "AIzaSyCb3ZNhIUKrfc7LoeWhblMrRnpc00Dlgd0",
  authDomain: "dslaundry-final.firebaseapp.com",
  projectId: "dslaundry-final",
  storageBucket: "dslaundry-final.firebasestorage.app",
  messagingSenderId: "72876645159",
  appId: "1:72876645159:web:22f6a5a20f3716bcda6702"
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();

db.enablePersistence().catch(err => {
  if (err.code === 'failed-precondition') console.warn('Persistence: multiple tabs');
  else if (err.code === 'unimplemented')  console.warn('Persistence not supported');
});

// =============================================
//  BRANCH DEFINITIONS
// =============================================
window.DS_BRANCHES = [
  { id: 'ubujan',   name: 'Ubujan',   color: '#7C3AED', gradient: 'linear-gradient(135deg,#7C3AED,#9D6CF5)' },
  { id: 'taloto',   name: 'Taloto',   color: '#1D4ED8', gradient: 'linear-gradient(135deg,#1D4ED8,#3B82F6)' },
  { id: 'bingag',   name: 'Bingag',   color: '#D97706', gradient: 'linear-gradient(135deg,#D97706,#F59E0B)' },
  { id: 'catarman', name: 'Catarman', color: '#C0311A', gradient: 'linear-gradient(135deg,#C0311A,#E5533A)' },
];

// =============================================
//  LOAD SIZE CATEGORIES
// =============================================
window.DS_LOAD_SIZES = [
  { value: '8kg', label: '8 kg — T-shirts, Shorts, Underwear & Regular Clothing' },
  { value: '6kg', label: '6 kg — Blankets, Towels & Beddings' },
  { value: '3kg', label: '3 kg — Heavy Comforters' },
];

// =============================================
//  USER / ROLE HELPERS
// =============================================
window.getUserProfile = async function(uid) {
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    const d = doc.data();
    // Normalize branchId to lowercase so "Catarman" and "catarman" both work
    const branchId = (d.branchId || '').toLowerCase().trim() || null;
    const branch = DS_BRANCHES.find(b => b.id === branchId) || null;

    // Auto-heal: if Firestore has wrong casing, silently fix it
    if (d.branchId && d.branchId !== branchId) {
      db.collection('users').doc(uid).update({ branchId }).catch(() => {});
      console.warn(`[DS] Auto-fixed branchId casing: "${d.branchId}" → "${branchId}"`);
    }

    return {
      role:        d.role || 'branch',
      branchId:    branchId,
      branchName:  branch ? branch.name : null,
      branchColor: branch ? branch.color : null,
      branchGrad:  branch ? branch.gradient : null,
      name:        d.name || '',
    };
  } catch(e) { console.error('getUserProfile:', e); return null; }
};

window.branchCol = function(branchId, collName) {
  return db.collection('branches').doc(branchId).collection(collName);
};

// =============================================
//  DEFAULT SERVICES — only seeded if branch
//  has NO services yet. Admin can freely add,
//  edit, or delete services from the admin
//  panel and they will appear in real-time on
//  the branch order form.
// =============================================
const _DEFAULT_SERVICES = [
  { name: 'Drop-Off, Wash, Fold', price: 210, duration: '1 day',    order: 1 },
  { name: 'Drop-Off, Wash',       price: 180, duration: 'Same day', order: 2 },
];

const _DEFAULT_ADDONS = [
  { name: 'Fabcon',    price: 15, order: 1 },
  { name: 'Bleach',    price: 15, order: 2 },
  { name: 'Detergent', price: 15, order: 3 },
];

// FIX: Only seed if the branch has zero services.
// NEVER delete services — admin manages them from the Price Management panel.
async function _seedBranch(branchId) {
  if (!branchId) return;
  branchId = branchId.toLowerCase().trim(); // defensive normalization
  try {
    const svcCol  = branchCol(branchId, 'services');
    const svcSnap = await svcCol.limit(1).get();

    // Only write defaults when the branch has no services at all
    if (svcSnap.empty) {
      const batch = db.batch();
      _DEFAULT_SERVICES.forEach(svc => batch.set(svcCol.doc(), svc));

      // Seed add-ons only if none exist
      const addonSnap = await branchCol(branchId, 'addons').limit(1).get();
      if (addonSnap.empty) {
        _DEFAULT_ADDONS.forEach(a => batch.set(branchCol(branchId, 'addons').doc(), a));
      }

      batch.set(db.collection('branches').doc(branchId), {
        name: DS_BRANCHES.find(b => b.id === branchId)?.name || branchId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      console.log('[DS] Default services seeded for branch:', branchId);
    } else {
      // Ensure branch document exists
      await db.collection('branches').doc(branchId).set({
        name: DS_BRANCHES.find(b => b.id === branchId)?.name || branchId,
      }, { merge: true });
    }
  } catch(e) { console.error('Seed error:', branchId, e); }
}

firebase.auth().onAuthStateChanged(async user => {
  if (!user) return;
  const profile = await getUserProfile(user.uid);
  if (!profile) return;
  if (profile.role === 'admin') {
    for (const b of DS_BRANCHES) await _seedBranch(b.id);
  } else if (profile.branchId) {
    await _seedBranch(profile.branchId);
  }
});