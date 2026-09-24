# 배포 Hub를 통한 동기화·지연 실험

이 도구는 별도 `MEMORIZE_ROOT`를 가진 두 Docker 컨테이너에서 `memorize@2.4.0`을 실행하고, HTTPS로 배포 Hub에 접속해 복제 이벤트의 수렴과 지연을 측정한다. 물리 기기 두 대를 뜻하지 않는다.

**보존용 실험 도구다.** 기존 공개 Hub의 운영을 보장하지 않는다. [과거 실측 결과](./RESULTS.md)와 [최종 상태](../docs/final-status.md)를 확인하고, 재현 시 본인이 운영하는 Hub와 테스트용 키를 사용한다. 아래 키 발급 설명은 당시의 수동 승인 흐름이며 현재 gateway의 계정·워크스페이스 흐름과 구분한다.

## 준비와 실행

Docker가 필요하다. Docker Desktop 없이 WSL의 Docker Engine에서도 실행할 수 있다. 이 디렉터리에서 실행한다.

```bash
HUB=https://<your-hub> ./run.sh build
HUB=https://<your-hub> ./run.sh init
# 당시 흐름: 출력된 프로젝트 ID에 대해 운영자가 /admin에서 키를 승인
HUB=https://<your-hub> ./run.sh converge <PROJECT> <KEY>
HUB=https://<your-hub> ./run.sh latency <PROJECT> <KEY> [ROUNDS]
./run.sh clean
```

`build`는 실험 이미지를 만들고, `init`은 첫 컨테이너에서 프로젝트를 생성한다. `converge`는 양방향 전송 후 복제 이벤트 집합의 바이트 일치를 검사한다. 로컬 `sync.*` 기록은 동기화하지 않으므로 비교에서 제외한다. `latency`는 준비 회차를 버리고 기본 5회의 push·pull 시간을 집계한다. `clean`은 실험 컨테이너와 이미지를 제거한다.

스크립트의 `HUB` 기본값은 과거 공개 배포 주소이므로 반드시 원하는 테스트 환경으로 재정의한다. 운영 배포 절차는 [배포 문서](../docs/DEPLOY.md)를 참고한다.
