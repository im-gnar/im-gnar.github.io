---
layout: post
title: "도메인 객체 기반 키 설계"
date: 2025-05-17 00:22:00 +0530
excerpt: "UUIDv7, 복합키, 그리고 타입 안전성"
categories: DDD
tags: spring
---


## Virtual Thread

Java의 동시성 프로그래밍은 오랫동안 OS 스레드를 직접 매핑한 Platform Thread를 기반으로 발전해왔습니다. 2023년 9월 19일, Java 21 LTS에서는 이러한 전통적인 스레드 모델과 함께 새로운 경량 스레드 모델인 `Virtual Thread`가 도입되었습니다.([JEP 444: Virtual Threads](https://openjdk.org/jeps/444)) 이는 최근 프로그래밍 언어들의 트렌드를 반영한 것으로, Go의 Goroutine, Kotlin의 Coroutine과 같은 경량 스레드 모델들이 높은 동시성 처리를 위한 해결책으로 주목받고 있는 흐름과 맥을 같이 합니다. 

`Lightweight Thread(경량 스레드)`는 실행 단위를 더 작은 단위로 나눠 Context switching 비용과 Blocking 타임을 낮추고, Kernel 레벨이 아닌 Runtime 레벨의 Task Scheduling 으로 효율적인 리소스 활용이 가능하다는 장점이 있어 클라우드 네이티브 환경에서의 대규모 동시성 처리에 적합한 해결책으로 떠오르고 있습니다.


### 배경


전통적인 Java 웹 애플리케이션은 `Thread-per-Request` 모델을 기반으로 동작해왔습니다. 각 HTTP 요청마다 하나의 스레드가 할당되어 요청을 처리하는 방식은 직관적이고 이해하기 쉽다는 장점이 있습니다. 하지만 이 모델은 동시에 몇 가지 한계점을 가지고 있습니다.

- **제한된 처리량**: OS 스레드는 생성과 유지에 상당한 시스템 리소스가 필요하기 때문에, 어플리케이션의 처리량이 Thread pool 크기에 직접적으로 제한되었습니다.
- **비효율적인 리소스 활용**: 특히 IO 작업이 많은 애플리케이션에서는 스레드들이 대부분의 시간을 blocking 상태로 보내게 되어, 리소스가 효율적으로 활용되지 못했습니다.

이러한 문제들을 해결하기 위해 Spring WebFlux와 같은 Reactive Programming 모델이 등장했습니다. 이벤트 루프 기반의 non-blocking 모델은 적은 수의 스레드로 높은 처리량을 달성할 수 있었지만, 다음과 같은 새로운 문제들을 야기했습니다.

- **높은 학습 비용**: 리액티브 프로그래밍은 기존의 명령형 프로그래밍과는 매우 다른 사고방식을 요구했습니다.
- **라이브러리 호환성**: 기존의 blocking IO 기반 라이브러리들을 모두 리액티브 방식으로 재작성해야 했습니다.(WebClient, R2DBC...)
- **디버깅의 어려움**: 요청이 여러 스레드를 넘나들며 처리되는 Reactive 방식은 Context 확인이 어려워 디버깅을 복잡하게 만들었습니다.


이러한 배경에서 `Java Virtual Thread`는 다음과 같은 목표를 가지고 탄생했습니다.

- **높은 처리량**: Reactive Programming의 장점인 높은 처리량을 달성
- **쉬운 프로그래밍 모델**: 전통적인 Thread 모델의 장점인 간단한 프로그래밍 모델을 유지
- **기존 코드 호환성**: 기존 Java 코드를 최소한의 수정으로 활용 가능
- **디버깅 용이성**: Thread Local, Exception, Profile 등 전통적인 자바 플랫폼의 방식을 그대로 사용 가능


Virtual Thread는 JVM 내부에서 자체적으로 스케줄링되는 경량 실행 단위로, OS 스레드에 직접 매핑되는 대신 작업이 필요할 때만 Platform Thread(Carrier Thread)에 마운트되어 실행됩니다. 이를 통해 수십만 개의 동시 작업을 효율적으로 처리할 수 있게 되었고, 특히 IO 작업이 많은 워크로드에서 큰 성능 향상을 기대할 수 있게 되었습니다.



### Platform Thread vs Virtual Thread

**Platform Thread (Java의 전통적인 Thread)**

![](https://velog.velcdn.com/images/_koiil/post/a8249302-51df-4a45-9d22-40014cdaaff6/image.png)

- OS Thread를 1:1로 매핑한 JVM 수준의 추상화 구현체
  - JVM이 Platform Thread를 생성할 때 JNI(Java Native Interface)를 통해 (Kernel)의 네이티브 스레드를 직접 할당받음
  - 커널 스레드와 직접 매핑되어 있어 OS 스케줄러에 의해 CPU 코어에 직접 스케줄링됨
- 생성 비용과 유지 비용이 높음
  - 각 스레드마다 고정된 스택 메모리(1MB)를 미리 할당
  - 컨텍스트 스위칭 시 커널 모드 전환이 필요해 상대적으로 높은 비용 발생(1-10μs)
  - OS가 관리할 수 있는 스레드 수에 제한이 있어 동시 처리 가능한 요청 수가 제한됨
- Thread Pool을 통한 재사용이 필수적
  - 비싼 자원인 플랫폼 스레드를 생성/소멸 비용을 줄이기 위해 미리 생성된 스레드를 재사용
  - 일반적으로 CPU 코어 수의 몇 배 정도로 풀 사이즈를 설정
  

**Virtual Thread**
![](https://velog.velcdn.com/images/_koiil/post/d52d7ca3-f9b2-4be1-bf51-b24533166183/image.png)


- JVM 런타임에 의해 관리되는 경량 실행 단위
  - OS 스레드에 직접 매핑되지 않고, 작업 실행이 필요할 때만 Platform Thread(Carrier Thread)에 마운트
  - JVM의 스케줄러가 Virtual Thread의 실행을 관리
- 매우 적은 리소스로 생성 가능
  - 스레드당 메타데이터 크기가 약 200~300바이트로 매우 작음
  - 스택 메모리를 heap에서 동적으로 할당하여 필요한 만큼만 사용
  - JVM 내부에서의 컨텍스트 스위칭으로 매우 빠른 전환 가능(나노초 단위)
- ForkJoinPool을 기반으로 한 효율적인 스케줄링
  - 기본적으로 CPU 코어 수만큼의 Carrier Thread가 Virtual Thread들을 실행
  - Work-Stealing 알고리즘을 통해 부하를 균등하게 분산
  - Blocking 작업 발생 시 자동으로 언마운트되어 다른 Virtual Thread가 실행됨




> | 사용하는 자원 | Platform Thread | Virtual Thread|
> |:--:|:--:|:--:|
> |Metadata size| 약 2kb(OS별 차이 있음)| 200~300B | 
> |Memory| 미리 할당된 Stack | 필요시 마다 Heap |
> |Context Switching Cost| 1-10us(커널 영역에서 발생) | ns (or 1us 미만)|




### Quick Start

Spring Boot 3.2 이상

```yml
# application.yaml
spring:
  threads:
    virtual:
      enabled: true
```
Spring Boot 3.2 미만

```java
// Web Request 를 처리하는 Tomcat 이 Virtual Thread를 사용하도록 한다.
@Bean
public TomcatProtocolHandlerCustomizer<?> protocolHandlerVirtualThreadExecutorCustomizer() 
{
  return protocolHandler -> {
    protocolHandler.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
  };
}

// Async Task에 Virtual Thread 사용
@Bean(TaskExecutionAutoConfiguration.APPLICATION_TASK_EXECUTOR_BEAN_NAME)
public AsyncTaskExecutor asyncTaskExecutor() {
  return new TaskExecutorAdapter(Executors.newVirtualThreadPerTaskExecutor());
}
```


### 사용 시 주의할 점

- ThreadLocal 사용 시 메모리 사용량 증가 ([JEP 425: Thread-local variables](https://openjdk.org/jeps/425#Thread-local-variables))
  - Virtual Thread는 작업당 하나씩 생성을 권장하며, 각각 독립된 ThreadLocal 공간을 가짐
  - 때문에 의도치않게 더 많은 메모리를 사용하는 원인이 될 수 있음
  - 컨텍스트 전파가 필요한 경우 ScopedValue 또는 ThreadLocalAccessor 사용 권장
- synchronized 키워드 사용 시 성능 저하 ([JEP 425: Pinning](https://openjdk.org/jeps/425#Executing-virtual-threads))
  - synchronized 블록 진입 시 Virtual Thread가 Carrier Thread에서 unmount 불가능한 상태가 됨 (Pinning)
  - ReentrantLock 등 java.util.concurrent 패키지의 락 구현체 사용 권장
- 과도한 동시성으로 인한 리소스 부족 주의
  - DB Connection Pool과 같은 제한된 자원에 대한 동시 접근이 증가하여 timeout 발생 가능 (SQLTransientConnectionException)
  - 필요한 경우 Semaphore를 통한 동시성 제어 검토
  - HikariCP 등 Connection Pool 크기와 Virtual Thread 수 간의 적절한 조정 필요
- CPU bound 보다는 IO bound 워크로드에 적합
  - CPU 코어에 스레드를 연결한 채 계산하는 CPU bound 워크로드는 Blocking 동안 대기하는 시간이 없기 때문에 이점이 없다.
  - 오히려 Virtual Thread Scheduling 의 마운팅/언마운팅 오버헤드때문에 Platform Thread 가 더 효율적
- Structured Concurrency 활용 ([JEP 428](https://openjdk.org/jeps/428))
  - 기존의 CompletableFuture 체인은 작업 실패 시 리소스 누수나 에러 전파가 불명확할 수 있음
  - Virtual Thread 사용 시 StructuredTaskScope을 통해 작업 그룹의 생명주기를 명시적으로 관리하는 것을 권장
  - 작업의 범위와 생명주기가 명확해져 디버깅과 유지보수가 용이

```java
// 권장 X (작업 실패 시 다른 작업의 취소나 리소스 정리가 보장되지 않음)
CompletableFuture<User> user = CompletableFuture.supplyAsync(() -> fetchUser());
CompletableFuture<Order> order = CompletableFuture.supplyAsync(() -> fetchOrder());

// 권장
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Future<User> user = scope.fork(() -> fetchUser());
    Future<Order> order = scope.fork(() -> fetchOrder());
    
    scope.join();          // 모든 작업 완료까지 대기
    scope.throwIfFailed(); // 작업 실패 시 모든 작업 취소 및 예외 전파
    
    // 모든 작업이 성공한 경우에만 실행
    processUserOrder(user.resultNow(), order.resultNow());
} // scope를 벗어나면 모든 자식 작업이 자동으로 정리됨
```


> `Scoped Value`
- ThreadLocal을 대체하기 위한 새로운 컨텍스트 전파 메커니즘 ([JEP 429](https://openjdk.org/jeps/429), [JEP 446](https://openjdk.org/jeps/446))
  - Virtual Thread 환경에 최적화된 불변 컨텍스트 전달 방식
  - ThreadLocal과 달리 메모리 누수 위험이 없고 명시적인 스코프 관리
  - 자식 Virtual Thread로의 자동 전파 지원
```java
final ScopedValue<User> CURRENT_USER = ScopedValue.newInstance();
void processWithUser(User user) {
    ScopedValue.where(CURRENT_USER, user)
        .run(() -> {
            // 이 스코프 내의 모든 Virtual Thread에서 CURRENT_USER 접근 가능
            new VirtualThread(() -> {
                User u = CURRENT_USER.get();
                processUserData(u);
            }).start();
        });
}
```

### 성능 테스트

8 Core 8 G Memory 인스턴스 2대로 성능 테스트를 진행한 결과입니다.
DB IO 보다는 외부 API 호출이 많기 때문에 DB 사용량은 두 케이스 모두 미미하고, Virtual Thread 가 아무리 빨라도 Response Time은 가장 느린 API 의 응답 시간과 동일했습니다.
동일하게 DB 에 대한 리소스는 고려해야할 정도는 아니었고, 외부 API 에 부담이 갈 정도의 성능을 요구하지는 않아 backpressure 처리는 톰캣 스레드만 플랫폼으로 연결하는 정도로 설정했습니다.


#### Virtual Thread 사용

- 100 TPS
- Avr Response time: 0.186 (sec)
- CPU Utilization :  Server 35%, DB 1% 이하, Global Cache(Redis) 2%
- 요청 1회당 약 80개의 virtual thread 생성

![](https://velog.velcdn.com/images/_koiil/post/cb5824d8-5673-4d93-93b2-48341d6ca44c/image.png)

![](https://velog.velcdn.com/images/_koiil/post/e6e8511d-a662-48b8-8975-358653883dbf/image.png)

![](https://velog.velcdn.com/images/_koiil/post/757d0d21-043f-4c3f-a037-1cdec364f991/image.png)



#### Platform Thread 사용

- 10 TPS
- Max Response time: 30 (sec)
- CPU Utilization :  Server 40% -> 3% (응답 지연으로 인한 사용량 감소), DB 1% 이하, Global Cache(Redis) 2%

![](https://velog.velcdn.com/images/_koiil/post/81429ff8-0798-4cce-8477-9c970899dbd4/image.png)


![](https://velog.velcdn.com/images/_koiil/post/4bc70550-72ce-43d3-8d69-847f4dc0b972/image.png)


![](https://velog.velcdn.com/images/_koiil/post/ac4d2be8-e95a-4f8b-baa2-14afa89eba41/image.png)



### Ref.
- [JEP 444](https://openjdk.org/jeps/444), [JEP 425](https://openjdk.org/jeps/425)
- [JDK 21의 신기능 Virtual Thread 알아보기](https://www.youtube.com/watch?v=vQP6Rs-ywlQ&list=PLZFZNBX75NZt_-NBd_oCkOQt2Hh5s_MfH&index=6)
- [Virtual Thread의 기본 개념 이해하기](https://d2.naver.com/news/1203723)
- [Virtual Thread support reference](https://quarkus.io/guides/virtual-threads)
- [Oracle docs - Virtual Threads](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html#GUID-BEC799E0-00E9-4386-B220-8839EA6B4F5C)
- [Virtual Thread란 무엇일까?](https://findstar.pe.kr/2023/04/17/java-virtual-threads-1/)
- [[Project Loom] Virtual Thread에 봄(Spring)은 왔는가](https://tech.kakaopay.com/post/ro-spring-virtual-thread/)
- [Java의 미래, Virtual Thread](https://techblog.woowahan.com/15398/)
- [LY - Java 가상 스레드](https://techblog.lycorp.co.jp/ko/about-java-virtual-thread-3)
