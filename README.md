# 인천대학교 연속간행물실 근무 대시보드

Flask + Gunicorn + SQLite로 실행하는 근무 관리 서비스. 화면과 API를 한 컨테이너에서 제공하며 데이터는 Docker 볼륨에 보관한다.

- 날짜별 주간 시간표, 30분 교대, 근무 구간에서 계산한 개인별 통계
- 실제 한국 시간 기준 이전·현재·다음 근무, 다른 주 시간표 복사
- 근무자 이름·전화번호·재직 상태 관리, 이슈 작성·완료
- 관리자·근무자 권한, 계정 관리·비밀번호 변경, DB 백업 다운로드
- 인천대학교 공식 로고와 Blue/Yellow를 사용한 반투명 대시보드
- 과월호·태깅은 준비 중 탭

## 실행

Python 3.12, `pip install -r requirements.txt`.

필수 환경변수:

| 이름 | 용도 |
| --- | --- |
| `SECRET_KEY` | 32자 이상의 무작위 세션 서명 키. 재시작·배포 시 동일하게 유지 |
| `ADMIN_USER` | 첫 실행 때 생성할 관리자 아이디 |
| `ADMIN_PASSWORD` | 초기 비밀번호, 10자 이상. 저장소나 이미지에 넣지 않음 |
| `DATABASE` | 기본 `/app/data/library.sqlite3` |
| `APP_BASE_PATH` | 기본 `/libaryDashBoard` |
| `COOKIE_SECURE` | 운영 `true`, 로컬 HTTP 개발 때만 `false` |
| `INITIAL_SCHEDULE_JSON` | 선택 사항. 첫 실행 때만 가져올 근무자·시간표 JSON |

```bash
gunicorn --bind 127.0.0.1:8000 --workers 1 --threads 2 'app:create_app()'
python -m unittest discover -s tests -v
```

`seed.json`은 빈 템플릿이다. 실제 근무자·시간표·전화번호는 공개 소스에 포함하지 않는다. 초기 데이터는 비공개 환경변수로 넣는다. 기존 DB가 있으면 초기 데이터·관리자 환경변수로 덮어쓰지 않는다. 비밀번호 변경은 로그인 후 계정 메뉴에서 한다.

## Server Desk 배포

`main` push → GitHub Actions 테스트 → `ghcr.io/eatyummydance200/library-dashboard:main` 및 커밋 SHA 태그 게시. 배포는 Server Desk에서 실행한다. 비공개 GHCR 패키지는 기존 Server Desk에 읽기 자격 증명을 설정해야 하며, 공개 패키지는 익명 pull 가능 여부를 확인한다.

| 항목 | 값 |
| --- | --- |
| 앱 이름 | `library-dashboard` |
| 호스트 포트 | `8090` |
| 컨테이너 포트 | `8000` |
| 바인딩 | `127.0.0.1` |
| 상태 확인 | `/libaryDashBoard/healthz` |
| 볼륨 | `data:/app/data` → `sd-library-dashboard-data` |
| 자동 업데이트 | 초기 꺼짐 |

Funnel 루트는 기존 Server Desk에 유지하고 새 경로만 추가한다. Funnel이 mount 접두 경로를 제거하므로 대상 URL에 동일한 접두 경로를 넣는다.

```bash
sudo tailscale funnel --bg --https=443 \
  --set-path=/libaryDashBoard \
  http://127.0.0.1:8090/libaryDashBoard
```

외부 주소의 `/libaryDashBoard`는 `/libaryDashBoard/`로 이동한다. 로그인·정적 파일·API·쿠키 모두 해당 경로를 사용한다.

## 데이터 규칙

근무일과 정수 분으로 시간표를 저장한다. 시작 포함·종료 제외이며 같은 사람의 겹치는 근무는 저장할 수 없다. 오픈은 09:00에 근무한 사람, 마감은 21:00까지 근무한 사람을 날짜별 한 번씩 센다. 일반·데스크 역할 변경은 별도 구간으로 저장한다.

다른 주 복사는 대상 주가 비어 있을 때만 허용하며 원본 주를 바꾸지 않는다. 재직 비활성화는 과거 근무를 삭제하지 않는다. 이슈 조회는 최근 200건이다.

## 백업과 복구

관리자 화면에서 DB 백업을 다운로드할 수 있다. 서버에서는 다음 명령이 SQLite backup API로 일관된 스냅샷을 만들고 7일 이전 스냅샷을 정리한다.

```bash
docker exec sd-library-dashboard python /app/scripts/backup.py
```

설치용 systemd service/timer는 `ops/`에 있다. 매일 한국 시간 04시에 실행한다. 같은 볼륨 안의 백업은 디스크 고장에 대비하지 못하므로 다운로드한 백업을 별도 기기에 보관한다.

복구 시 서비스를 중지하고 현재 데이터 디렉터리 전체를 먼저 보관한다. 백업 파일의 `PRAGMA integrity_check`를 확인한 뒤 DB를 복원하고, 이전 DB의 `-wal`, `-shm` 파일이 새 DB와 섞이지 않도록 제거한다. 파일 소유자는 컨테이너 사용자 UID 10001로 유지한다. 그 후 서비스를 시작해 로그인·시간표·이슈를 확인한다. 이미지 롤백은 DB 변경을 되돌리지 않는다.

## 제한

한 서버·한 앱 프로세스·소규모 팀을 기준으로 한다. 여러 서버에서 동시 쓰기나 컨테이너 수평 확장이 필요하면 SQLite를 재검토한다. Funnel의 경로 분리는 별도 출처 격리가 아니므로 같은 도메인의 Server Desk와 보안 경계를 공유한다.

디자인 참고와 데이터 설계는 [ARCHITECTURE.md](ARCHITECTURE.md). 공식 브랜드 출처: [인천대학교 UI](https://www.inu.ac.kr/inu/728/subview.do).
