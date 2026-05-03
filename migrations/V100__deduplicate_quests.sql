-- V100: Remove duplicate quests created by multiple migration runs
-- Keep lowest id for each (quest_type, target_action, target_count) combination
-- Remap quest_progress to surviving IDs before deletion

-- Step 1: Remap progress records to the surviving (lowest id) quest
WITH ranked AS (
  SELECT id,
    FIRST_VALUE(id) OVER (
      PARTITION BY quest_type, target_action, target_count
      ORDER BY id
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY quest_type, target_action, target_count
      ORDER BY id
    ) AS rn
  FROM gamification_quests
)
UPDATE gamification_quest_progress qp
SET quest_id = r.keep_id
FROM ranked r
WHERE qp.quest_id = r.id AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM gamification_quest_progress
    WHERE quest_id = r.keep_id AND employee_id = qp.employee_id
  );

-- Step 2: Delete orphaned progress that couldn't be remapped (conflict with existing)
DELETE FROM gamification_quest_progress
WHERE quest_id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY quest_type, target_action, target_count
        ORDER BY id
      ) AS rn
    FROM gamification_quests
  ) ranked
  WHERE rn > 1
);

-- Step 3: Delete duplicate quest definitions (keep lowest id per unique combo)
DELETE FROM gamification_quests
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY quest_type, target_action, target_count
        ORDER BY id
      ) AS rn
    FROM gamification_quests
  ) ranked
  WHERE rn > 1
);

-- Step 4: Prevent future duplicates
ALTER TABLE gamification_quests
  DROP CONSTRAINT IF EXISTS gamification_quests_unique_combo;
ALTER TABLE gamification_quests
  ADD CONSTRAINT gamification_quests_unique_combo
  UNIQUE (quest_type, target_action, target_count);
