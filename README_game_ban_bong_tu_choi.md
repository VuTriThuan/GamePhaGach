# Đặc tả triển khai: Game bắn bóng phá gạch tự chơi và quay video

> Đây là tài liệu giao việc cho Codex. Hãy **xây dựng mã nguồn chạy được**, không chỉ tạo giao diện minh họa. Trò chơi lấy cảm hứng từ ảnh tham chiếu người dùng cung cấp: nhiều bóng nảy phá các khối có số, các khối tiến về vạch thua. Vẽ đồ họa và tạo âm thanh riêng, không sao chép hình nhân vật, biểu tượng, phông nền hay quảng cáo trong ảnh.

## 1. Mục tiêu và quyết định đã chốt

- Chạy cục bộ trên máy tính trong trình duyệt, miễn phí, không cần tài khoản, API, máy chủ từ xa hoặc dịch vụ trả phí. Ưu tiên tương thích với macOS Intel và Node.js 20.
- Toàn bộ nội dung được quay nằm trong **màn hình A**, một canvas dọc có tỷ lệ **9:16**, kích thước nội bộ mặc định **720 × 1280 px**. Canvas có thể thu nhỏ để vừa cửa sổ máy tính nhưng luôn giữ đúng tỷ lệ; video xuất ra ở độ phân giải nội bộ.
- **Máy tự chơi hoàn toàn**: tự ngắm, tự bắn, tự chờ bóng về, tự tạo lượt mới và tự bắt đầu ván mới khi thua. Người xem không cần bấm, giữ chuột hoặc điều khiển hướng bắn. Game tự chạy khi mở trang.
- Ba nút **“Bắt đầu quay”**, **“Dừng quay”**, **“Tải video”** nằm ở vùng điều khiển **bên ngoài** màn hình A. Chỉ quay pixel trong màn hình A; không quay nút, con trỏ, tab trình duyệt hoặc toàn bộ desktop.
- Khi thua, cho thấy rõ viên gạch gây thua và số HP còn lại trên nó, hiển thị trạng thái thua khoảng 1–2 giây, rồi tự khởi tạo và chơi ván mới. Việc quay, nếu đang diễn ra, **không dừng** và không tạo file mới ở ranh giới các ván.

### Điều kiện thua

Số trên gạch là HP hiện còn, không phải tổng điểm của người chơi hoặc số lượt chơi. Ván thua khi một viên gạch còn HP thực sự chạm/cắt vạch thua. Không giới hạn số trên viên gạch gây thua và không kích hoạt màn hình thua bằng bộ đếm thời gian giả.

## 2. Công nghệ và cách giao hàng

- React + Vite + TypeScript; vẽ game trong HTML Canvas 2D. Có thể dùng thư viện vật lý nhẹ nếu nó giúp xử lý va chạm chắc chắn, nhưng không yêu cầu backend hoặc database.
- Quay bằng `HTMLCanvasElement.captureStream(30)` + `MediaRecorder`. Ưu tiên WebM (`video/webm;codecs=vp9`, sau đó VP8 hoặc `video/webm`); chọn MIME được trình duyệt hỗ trợ bằng `MediaRecorder.isTypeSupported`. Nếu trình duyệt không hỗ trợ API cần thiết, báo rõ trong vùng điều khiển. **Không hứa file MP4 nếu không có bộ mã hóa MP4 tương thích.**
- Cấu trúc dự án dễ đọc: các phần game loop, mô hình gạch/bóng, vật lý, bộ tự chơi, sinh màn chơi, renderer, recorder và UI được tách thành module. Không đặt toàn bộ logic trong một component React.
- Cung cấp mã nguồn, `package.json`, hướng dẫn chạy (`npm install`, `npm run dev`), lệnh build (`npm run build`), hướng dẫn mở `localhost`, và phần ghi chú về định dạng video hỗ trợ. Không cần người dùng cài Python/Java hoặc đặt API key.
- Tài nguyên đồ họa sử dụng hình vẽ Canvas/CSS hoặc tài nguyên tự tạo có quyền sử dụng. Có thể dùng các tool/skill hỗ trợ tạo tài nguyên và kiểm tra UI, nhưng game phải chạy ngay cả khi không có dịch vụ ngoài.

## 3. Bố cục giao diện

### Bên trong màn hình A (phần được ghi hình)

- Nền dọc vui nhộn, gọn, đủ tương phản với bóng và khối gạch.
- Vùng trên: điểm số, số lượt hoặc cấp độ, số bóng đang sở hữu; tránh che khu vực chơi.
- Khu vực giữa: các hàng gạch có số HP lớn, dễ đọc; có thể có khối thưởng dạng rương hoặc biểu tượng `+ bóng` với quy tắc rõ ràng.
- Khu vực dưới: vạch thua nổi bật, vị trí phóng bóng và quỹ đạo xem trước ngắn khi máy đang ngắm. Không hiển thị ô trạng thái ngắm, bắn hoặc chờ bóng.
- Khi game over, làm nổi bật **đúng viên gạch gây thua** và HP tại thời điểm đó. Giữ frame thua đủ lâu để người xem đọc được con số, rồi tự chơi tiếp.

### Bên ngoài màn hình A (không được ghi hình)

- Ba nút có đúng nhãn: **Bắt đầu quay**, **Dừng quay**, **Tải video**.
- Hiển thị trạng thái quay, thời lượng, loại video và thông báo lỗi/ngắn gọn.
- Bố trí cạnh màn hình A trên desktop; nếu cửa sổ hẹp, có thể chuyển xuống dưới, nhưng tuyệt đối không chồng lên canvas.
- `Dừng quay` chỉ khả dụng khi đang quay; `Tải video` chỉ khả dụng sau khi bản ghi đã hoàn tất. Bấm tải lại được cùng một bản ghi cho tới khi bắt đầu quay mới.

## 4. Luật chơi tối thiểu

1. Một ván bắt đầu với vị trí bắn gần đáy và một lượng bóng ban đầu vừa phải. Tạo các hàng gạch ở phía trên; mỗi gạch có `id`, vị trí, kích thước, HP còn lại và kiểu hiển thị. HP luôn đồng bộ với số vẽ trên gạch.
2. Mỗi lượt, máy chọn hướng bắn hợp lệ trong góc cho phép; bắn cả loạt bóng theo hướng đó, cách nhau một khoảng thời gian nhỏ. Bóng có vận tốc và bán kính xác định.
3. Bóng nảy ở biên trái/phải, trần và mặt gạch; mỗi lần va chạm hợp lệ làm gạch mất **1 HP**. Nếu HP về 0, gạch biến mất và có hiệu ứng ngắn. Xử lý để một bóng không trừ HP lặp vô hạn khi vẫn đang chồng lên cùng một gạch.
4. Bóng chạm mép dưới vùng chơi thì được thu hồi, không văng ra ngoài. Khi **toàn bộ** bóng đã được thu hồi, chốt lượt, cập nhật vị trí bắn và cho các hàng gạch tiến xuống một nấc; tạo hàng mới nếu đến lượt. Có cơ chế chống kẹt để bóng không nảy vô hạn.
5. Khối thưởng nếu có phải khác gạch HP về mặt hình ảnh và luật: chạm vào khối thưởng sẽ tăng số bóng cho lượt tiếp theo theo con số ghi trên khối thưởng. Có thể bỏ khối thưởng ở phiên bản đầu nếu cần ưu tiên độ ổn định; không được để số trên rương gây nhầm với HP viên gạch thua.
6. Thua khi **sau lúc các hàng tiến xuống**, ít nhất một viên gạch còn HP cắt/chạm vạch thua. Lưu `losingBrickId` và `losingBrickHp` từ chính đối tượng vật lý gây thua, dùng chúng để hiển thị và ghi log.
7. Sau khoảng 1–2 giây ở màn hình thua, reset mọi trạng thái **của ván chơi** (bóng, gạch, lượt, điểm, AI), tăng bộ đếm số ván và tự bắt đầu ván tiếp theo. Không reset trạng thái quay video.

## 5. Bộ tự chơi và điều tiết độ khó

- Auto player là thành phần bắt buộc; người xem không có thao tác ngắm/bắn. Trước mỗi lượt, đánh giá nhiều góc bắn (ví dụ 25–61 góc) bằng phép mô phỏng quỹ đạo ngắn hoặc hàm chấm điểm. Ưu tiên phá gạch thấp gần vạch, đánh trúng nhiều gạch, tận dụng phản xạ tường và nhặt bóng thưởng. Nếu điểm các góc gần nhau, dùng bộ sinh số ngẫu nhiên có seed để các ván trông đa dạng nhưng có thể tái hiện.
- Thể hiện nhịp xem dễ theo dõi: dừng ngắm khoảng 0,2–0,6 giây, bắn loạt bóng, cho bóng chạy đủ nhanh, có thể tự tăng tốc ở cuối lượt khi quá lâu. Không phụ thuộc `setTimeout` cho va chạm vật lý; cập nhật vật lý với fixed timestep để hành vi ổn định ở các máy khác nhau.
- Độ khó có thể tăng theo lượt để ván chơi kết thúc theo luật chạm vạch. Không yêu cầu số trên gạch gây thua thuộc một khoảng cụ thể.
- Có thể đặt seed, tốc độ, số bóng và mức khó ở một module cấu hình, với giá trị mặc định hoạt động ngay. Không tạo nút yêu cầu người xem chỉnh các thông số này.
- Không sửa ngầm HP của viên gạch ngay trước lúc thua chỉ để qua kiểm thử.

## 6. Quay màn hình A

1. Mở game là **tự chơi**, nhưng **không tự quay**. Khi bấm `Bắt đầu quay`, chỉ lấy stream từ `canvasA.captureStream(30)`; không dùng `getDisplayMedia` để yêu cầu chọn màn hình desktop.
2. Ghi các `Blob` chunk từ `MediaRecorder`; khi bấm `Dừng quay`, đợi sự kiện `stop`, ghép chunk thành video rồi bật nút `Tải video`. Đặt tên có thời điểm, ví dụ `game-tu-choi-2026-10-10T01-00-00.webm`.
3. Nếu người dùng bấm bắt đầu bản ghi mới sau khi bản cũ đã dừng, giải phóng URL object cũ đúng lúc, làm sạch chunks và bắt đầu bản ghi mới. Không tải video rỗng hoặc hỏng khi `stop` chưa hoàn tất.
4. Nếu ván thua và reset trong lúc quay, bản ghi tiếp tục liền mạch qua màn hình thua và ván mới. Resize cửa sổ không đổi độ phân giải ghi hình, vì chỉ kích thước hiển thị CSS thay đổi.
5. Chấp nhận video không có tiếng trong phiên bản đầu; nếu thêm tiếng, âm thanh game phải là âm thanh tự tạo và phải ghép đúng track vào stream canvas. Không ghi mic hoặc âm thanh hệ thống.
6. Chạy ứng dụng ở tab foreground trong lúc quay; ghi rõ rằng trình duyệt có thể giảm nhịp `requestAnimationFrame` khi tab bị ẩn hoặc máy ngủ. Hiển thị lỗi nếu quay không khả dụng hoặc đã hết dung lượng bộ nhớ.

## 7. Trạng thái và xử lý lỗi

- State machine đề nghị: `AIMING → FIRING → RESOLVING → ADVANCING → (AIMING | GAME_OVER) → RESTARTING → AIMING`. Trạng thái recorder độc lập: `IDLE → RECORDING → STOPPING → READY`.
- Không bắn lượt mới khi còn bóng bay; không tạo hai vòng lặp animation; không khởi tạo nhiều recorder cùng lúc.
- Khi chuyển ván, hủy timeout/animation gắn với ván cũ hoặc dùng game session ID để callback cũ không tác động ván mới. Khi component unmount, dọn `requestAnimationFrame`, track stream và object URL.
- Ghi log ngắn trong dev console ở mỗi game over: `{ gameIndex, turn, losingBrickId, losingBrickHp }`. Hiển thị con số trên canvas để có thể đối chiếu với log.

## 8. Tiêu chí nghiệm thu (Codex phải tự kiểm tra)

1. `npm install`, `npm run dev`, `npm run build` chạy thành công; README dự án có lệnh chạy trên macOS và URL cục bộ.
2. Mở trang và không chạm chuột/bàn phím trong nhiều lượt: máy tự ngắm, bắn, phá gạch, sinh hàng mới, thua và tự chơi lại. Không có lần reset nào cần người dùng bấm.
3. Màn hình A luôn 9:16. Ở cả desktop lẫn cửa sổ hẹp, các nút vẫn nằm **ngoài** khung A; CSS resize không kéo méo bóng hoặc khối.
4. Quay ít nhất qua **một lần thua và tự bắt đầu ván mới**. Dừng, tải, mở tệp video: video 9:16 chỉ chứa màn hình A, chạy được, có cả hai ván và không chứa các nút điều khiển.
5. Trong ít nhất 5 ván tự chơi liên tiếp với seed kiểm tra cố định hoặc chế độ mô phỏng nhanh, mỗi lần thua đều có một viên gạch còn HP thực sự chạm vạch. Log và khung hình cuối ván khớp nhau. Nếu không đạt, sửa logic và kiểm tra lại.
6. `Bắt đầu quay` → `Dừng quay` → `Tải video` hoạt động nhiều chu kỳ liên tiếp; trạng thái nút đúng, không rò rỉ vòng lặp/stream rõ rệt hoặc có video 0 byte.
7. Có thể thêm kiểm tra tự động cho vật lý va chạm, điều kiện mất lượt/thua và trạng thái recorder. Tránh viết test chỉ kiểm tra component đã render mà không xác nhận gameplay.

## 9. Thứ tự triển khai yêu cầu Codex thực hiện

1. Khởi tạo dự án và canvas A đúng 720 × 1280, CSS fit trong cửa sổ, UI ngoài canvas.
2. Cài game loop fixed timestep, bóng, gạch, va chạm, lượt và điều kiện thua thật.
3. Cài AI tự chọn hướng bắn và tự reset; kiểm tra điều kiện thua qua nhiều ván mô phỏng.
4. Cài recorder chỉ lấy canvas A; xử lý hỗ trợ MIME và tải video.
5. Hoàn thiện đồ họa, HUD, hiệu ứng, khả năng đọc số HP trên video; kiểm tra thủ công một video quay qua hai ván.
6. Chạy build và các bài kiểm tra liên quan, sửa lỗi phát hiện, rồi bàn giao mã nguồn với lệnh chạy ngắn gọn.

### Prompt ngắn để đưa kèm file này cho Codex

> Hãy đọc toàn bộ file README này và xây dựng dự án game hoàn chỉnh theo đúng yêu cầu. Ưu tiên cơ chế máy tự chơi, điều kiện thua khi gạch còn HP chạm vạch và quay riêng canvas 9:16. Hãy tự chạy build, kiểm thử nhiều ván liên tiếp và kiểm tra video xuất ra trước khi bàn giao. Không dừng ở giao diện mẫu hoặc bản mô tả.
