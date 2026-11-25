-- Product copy for a fresh database (needs migration 0016). Production already got it from 0016.
UPDATE products SET tagline='把日子，过得脆甜',description='22 个苹果一箱，单果约 250g，总重约 5.5kg。适合日常吃、和家人朋友分享，也适合给冰箱补一点秋天。' WHERE id='FAMILY' AND tagline='';
UPDATE products SET tagline='认真挑，慢慢送',description='8 个苹果一箱，单果约 350g，总重约 2.8kg。适合送给在意的人，可填写朋友的收件地址，并附一段简短寄语。' WHERE id='GIFT' AND tagline='';
UPDATE products SET tagline='一季十斤一箱，分次寄给在意的人' WHERE id='PA' AND tagline='';
UPDATE products SET tagline='一季大果，慢慢分享' WHERE id='FG' AND tagline='';
