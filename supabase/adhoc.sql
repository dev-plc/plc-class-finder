-- '-' 표시가 실제로 어떻게 쓰였는지 확인
-- 결석 0인데 credited 가 낮은 인원들의 세션별 출결을 나열한다.
select
  m.name,
  m.phone,
  s.session_no,
  s.label,
  s.label_norm,
  coalesce(nullif(trim(a.status), ''), '(빈칸)') as status
from members m
join sessions s
  on s.cohort_id = m.cohort_id and s.is_class is true
left join attendance a
  on a.member_id = m.id and a.session_date = s.session_date
where m.cohort_id = '2기'
  and (m.name, m.phone) in (
    ('최원정','0480'), ('이정숙','2060'), ('노태훈','9103'),
    ('서수연','9618'), ('김세진','8930')
  )
order by m.name, s.session_no
