/* Seerti — shared account-deletion logic, used by the in-app modal (index.html) and delete-account.html.
   Firebase functions are injected via `fb`, so this file has no imports and both pages stay in sync.
   Order matters: re-authenticate -> delete Firestore data -> delete the Auth user. If any step fails the
   later steps are NOT run, so the user can simply retry and never ends up with orphaned data. */
const LOCAL_KEYS = ['local_resumes', 'seerti_jobs_v1', 'app_theme', 'app_lang', 'app_currency', 'onboarded_guest'];

export function providerOf(user) {
    const ids = (user && user.providerData || []).map(p => p.providerId);
    return ids.includes('password') ? 'password' : ids.includes('google.com') ? 'google' : 'other';
}

export function clearLocalData(uid) {
    try {
        if (uid) { localStorage.removeItem('cloud_cache_' + uid); localStorage.removeItem('onboarded_' + uid); return; }
        LOCAL_KEYS.forEach(k => localStorage.removeItem(k));
        Object.keys(localStorage).filter(k => /^(cloud_cache_|onboarded_)/.test(k)).forEach(k => localStorage.removeItem(k));
    } catch (_) { /* storage unavailable */ }
}

export function deleteErrorMessage(e) {
    const c = (e && e.code) || '';
    if (c === 'seerti/no-password' || c === 'auth/missing-password') return 'أدخل كلمة المرور لتأكيد هويتك.';
    if (c === 'auth/wrong-password' || c === 'auth/invalid-credential' || c === 'auth/invalid-login-credentials') return 'كلمة المرور غير صحيحة.';
    if (c === 'auth/user-not-found' || c === 'auth/invalid-email') return 'لا يوجد حساب بهذه البيانات.';
    if (c === 'auth/too-many-requests') return 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.';
    if (c === 'auth/network-request-failed' || c === 'unavailable') return 'تعذّر الاتصال بالإنترنت. تحقق من اتصالك وأعد المحاولة.';
    if (c === 'auth/requires-recent-login') return 'لأسباب أمنية، سجّل الدخول من جديد ثم أعد المحاولة.';
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return 'أُغلقت نافذة التأكيد قبل اكتمالها.';
    if (c === 'seerti/unsupported-provider') return 'طريقة تسجيل الدخول هذه تتطلب الحذف من صفحة الويب أو بمراسلتنا.';
    if (c === 'permission-denied') return 'تعذّر حذف البيانات بسبب صلاحيات الأمان. راسلنا لإتمام الحذف.';
    return 'تعذّر إتمام الحذف. لم يُحذف حسابك، يمكنك إعادة المحاولة.';
}

/** fb: {auth, db, EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup,
 *       collection, getDocs, writeBatch, deleteUser}; opts: {appId, password, recentLogin} */
export async function deleteAccountAndData(fb, opts) {
    const user = fb.auth.currentUser;
    if (!user) throw Object.assign(new Error('no user'), { code: 'seerti/no-user' });
    const kind = providerOf(user);
    if (!opts.recentLogin) {
        if (kind === 'password') {
            if (!opts.password) throw Object.assign(new Error('no password'), { code: 'seerti/no-password' });
            await fb.reauthenticateWithCredential(user, fb.EmailAuthProvider.credential(user.email, opts.password));
        } else if (kind === 'google') {
            await fb.reauthenticateWithPopup(user, new fb.GoogleAuthProvider());
        } else throw Object.assign(new Error('unsupported'), { code: 'seerti/unsupported-provider' });
    }
    const uid = user.uid;
    const snap = await fb.getDocs(fb.collection(fb.db, 'artifacts', opts.appId, 'users', uid, 'resumes'));
    let batch = fb.writeBatch(fb.db), pending = 0;
    for (const d of snap.docs) {
        batch.delete(d.ref);
        if (++pending === 400) { await batch.commit(); batch = fb.writeBatch(fb.db); pending = 0; }
    }
    if (pending) await batch.commit();
    await fb.deleteUser(user);
    clearLocalData(uid);
    return { deletedResumes: snap.size };
}
