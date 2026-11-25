-- The Stewart family, starting chores and reward goals. Edit freely in the app afterwards.

INSERT INTO users (id, name, full_name, colour, emoji, is_parent) VALUES
  ('lee-roy', 'Lee Roy', 'Lee Roy Stewart',          '#2f6f9f', '🧔', 1),
  ('shirley', 'Shirley', 'Shirley May Steyn Stewart', '#b5476b', '👩', 1),
  ('skyler',  'Skyler',  'Skyler Roy Stewart',       '#3e8e4e', '🧒', 0);

INSERT INTO settings (key, value) VALUES
  ('baby_name', 'Madilea'),
  ('baby_full_name', 'Madilea May Stewart'),
  ('baby_due',  '2027-01-06'),
  ('lat', '-26.1016'),
  ('lon', '27.7695'),
  ('town', 'Krugersdorp'),
  ('rain_threshold', '50'),
  ('schema_version', '2');

-- days: 1=Mon … 7=Sun
INSERT INTO task_templates (title, area, assignee, days, points, created_by) VALUES
  -- Skyler
  ('Make your bed',                          'Second bedroom', 'skyler',  '1234567', 5,  'shirley'),
  ('Tidy your room (floor clear, clothes away)', 'Second bedroom', 'skyler',  '1234567', 5,  'shirley'),
  ('Keep your cupboard neat',                'Second bedroom', 'skyler',  '36',      10, 'shirley'),
  ('Deep clean your room (dust, vacuum, bin)', 'Second bedroom', 'skyler',  '6',       15, 'shirley'),
  ('Make or help with breakfast',            'Kitchen',        'skyler',  '1234567', 5,  'shirley'),
  ('Pick up dog poo',                        'Yard',           'skyler',  '1234567', 5,  'lee-roy'),
  ('Help clean the yard',                    'Yard',           'skyler',  '6',       15, 'lee-roy'),
  -- Lee Roy
  ('Clean the bathroom (bath, basin, mirror)', 'Bathroom',     'lee-roy', '6',       15, 'shirley'),
  ('Clean the toilet (Domestos)',            'Toilet',         'lee-roy', '36',      10, 'shirley'),
  ('Clean the yard',                         'Yard',           'lee-roy', '6',       15, 'shirley'),
  ('Wash the car',                           'Car',            'lee-roy', '7',       15, 'shirley'),
  ('Take out the bins',                      'Kitchen',        'lee-roy', '1',       5,  'shirley'),
  ('Dishes after supper',                    'Kitchen',        'lee-roy', '1357',    5,  'shirley'),
  -- Shirley
  ('Wipe kitchen counters & stove',          'Kitchen',        'shirley', '1234567', 5,  'lee-roy'),
  ('Change bed linen',                       'Main bedroom',   'shirley', '7',       10, 'lee-roy'),
  ('Tidy the lounge',                        'Lounge',         'shirley', '25',      5,  'lee-roy'),
  ('Dishes after supper',                    'Kitchen',        'shirley', '246',     5,  'lee-roy'),
  ('Check Madilea''s nursery & hospital bag', 'Madilea',       'shirley', '3',       5,  'lee-roy');

INSERT INTO reward_goals (user_id, target, reward) VALUES
  ('skyler',  160, 'Pick the Friday movie + R100 pocket money'),
  ('shirley', 60,  'Saturday lie-in and breakfast in bed'),
  ('lee-roy', 75,  'Sunday afternoon off');
