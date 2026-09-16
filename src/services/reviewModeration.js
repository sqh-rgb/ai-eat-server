const crypto = require('node:crypto');

async function moderateReviewSubmission(client, { submissionId, decision, reason, actorLabel = 'local-reviewer' }) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('审核决定只能是 approved 或 rejected');
  const result = await client.query('SELECT * FROM user_review_submissions WHERE id=$1 FOR UPDATE', [submissionId]);
  const submission = result.rows[0];
  if (!submission) throw new Error('用户评价投稿不存在');
  if (decision === 'approved' && submission.risk_status === 'blocked') {
    throw new Error('被风控拦截的评价不能直接批准');
  }
  if (decision === 'approved') {
    const membership = await client.query(
      `SELECT 1 FROM merchant_branch_memberships
       WHERE user_subject_hash=$1 AND branch_id=$2 AND status='verified' LIMIT 1`,
      [submission.user_subject_hash, submission.branch_id],
    );
    if (membership.rows[0]) throw new Error('已认证商家账号不得批准为自家门店评价');
  }

  await client.query(
    `UPDATE user_review_submissions SET status=$2,moderation_reason=$3,moderated_at=NOW(),updated_at=NOW()
     WHERE id=$1`,
    [submissionId, decision, reason || '人工审核'],
  );

  if (decision === 'approved') {
    if (String(submission.public_text || '').trim()) {
      await client.query(
        `INSERT INTO reviews(
          id,source_id,source_review_id,branch_id,dish_id,public_text,rating,source_label,status,reviewed_at
         ) VALUES($1,'user-submission',$2,$3,$4,$5,$6,'AI Eat 用户评价','published',NOW())
         ON CONFLICT(source_id,source_review_id) DO UPDATE SET
           public_text=EXCLUDED.public_text,rating=EXCLUDED.rating,status='published',reviewed_at=NOW(),updated_at=NOW()`,
        [`user-review:${submissionId}`, submissionId, submission.branch_id, submission.dish_id,
          submission.public_text, submission.rating],
      );
    }
    if (submission.rating !== null) {
      const trustWeight = Number(submission.risk_score || 0) < 30 ? 1 : 0.5;
      await client.query(
        `INSERT INTO user_ratings(
          id,branch_id,user_subject_hash,rating,trust_weight,status,origin_submission_id,risk_score,moderated_at
         ) VALUES($1,$2,$3,$4,$5,'approved',$6,$7,NOW())
         ON CONFLICT(origin_submission_id) DO UPDATE SET
           rating=EXCLUDED.rating,trust_weight=EXCLUDED.trust_weight,status='approved',
           risk_score=EXCLUDED.risk_score,moderated_at=NOW()`,
        [`user-rating:${submissionId}`, submission.branch_id, submission.user_subject_hash,
          submission.rating, trustWeight, submissionId, submission.risk_score],
      );
    }
  } else {
    await client.query("UPDATE reviews SET status='removed',updated_at=NOW() WHERE source_id='user-submission' AND source_review_id=$1", [submissionId]);
    await client.query("UPDATE user_ratings SET status='removed',moderated_at=NOW() WHERE origin_submission_id=$1", [submissionId]);
  }

  await client.query(
    `INSERT INTO moderation_actions(id,entity_type,entity_id,action,reason,actor_label)
     VALUES($1,'user_review_submission',$2,$3,$4,$5)`,
    [crypto.randomUUID(), submissionId, decision, reason || '人工审核', actorLabel],
  );
  return { submissionId, status: decision };
}

module.exports = { moderateReviewSubmission };
