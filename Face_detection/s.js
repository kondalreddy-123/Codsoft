const imageInput =
    document.getElementById("imageInput");

const dropZone =
    document.getElementById("dropZone");

const previewCard =
    document.getElementById("previewCard");

const previewImage =
    document.getElementById("previewImage");

const fileName =
    document.getElementById("fileName");

const removeButton =
    document.getElementById("removeButton");

const resetButton =
    document.getElementById("resetButton");

const detectButton =
    document.getElementById("detectButton");

const cameraButton =
    document.getElementById("cameraButton");


let selectedFile = null;



/* --------------------------------------------------
   FILE SELECT
-------------------------------------------------- */

imageInput.addEventListener(
    "change",
    function () {

        if (this.files.length > 0) {

            handleFile(
                this.files[0]
            );

        }

    }
);



/* --------------------------------------------------
   HANDLE FILE
-------------------------------------------------- */

function handleFile(file) {

    if (!file.type.startsWith("image/")) {

        alert(
            "Please select a valid image file."
        );

        return;

    }


    selectedFile = file;


    fileName.textContent =
        file.name;


    const reader =
        new FileReader();


    reader.onload = function (event) {

        previewImage.src =
            event.target.result;

        dropZone.style.display =
            "none";

        previewCard.classList.add(
            "active"
        );

    };


    reader.readAsDataURL(file);

}



/* --------------------------------------------------
   DRAG & DROP
-------------------------------------------------- */

dropZone.addEventListener(
    "dragover",
    function (event) {

        event.preventDefault();

        dropZone.classList.add(
            "dragover"
        );

    }
);


dropZone.addEventListener(
    "dragleave",
    function () {

        dropZone.classList.remove(
            "dragover"
        );

    }
);


dropZone.addEventListener(
    "drop",
    function (event) {

        event.preventDefault();

        dropZone.classList.remove(
            "dragover"
        );


        const files =
            event.dataTransfer.files;


        if (files.length > 0) {

            handleFile(
                files[0]
            );

        }

    }
);



/* --------------------------------------------------
   REMOVE IMAGE
-------------------------------------------------- */

removeButton.addEventListener(
    "click",
    resetInterface
);


resetButton.addEventListener(
    "click",
    resetInterface
);


function resetInterface() {

    selectedFile = null;

    imageInput.value = "";

    previewImage.src = "";

    fileName.textContent =
        "Image Preview";

    previewCard.classList.remove(
        "active"
    );

    dropZone.style.display =
        "flex";

}



/* --------------------------------------------------
   DETECT BUTTON
-------------------------------------------------- */

detectButton.addEventListener(
    "click",
    function () {

        if (!selectedFile) {

            return;

        }


        detectButton.disabled =
            true;


        detectButton.innerHTML =
            `
            <span class="loading-spinner"></span>
            Analyzing...
            `;


        /*
         * Create a temporary form and
         * submit the selected image
         * to Flask.
         */

        const form =
            document.createElement("form");


        form.method = "POST";

        form.action = "/detect";

        form.enctype =
            "multipart/form-data";


        const dataTransfer =
            new DataTransfer();


        dataTransfer.items.add(
            selectedFile
        );


        const input =
            document.createElement("input");


        input.type = "file";

        input.name = "image";

        input.files =
            dataTransfer.files;


        form.appendChild(input);

        document.body.appendChild(form);


        form.submit();

    }
);



/* --------------------------------------------------
   CAMERA
-------------------------------------------------- */

cameraButton.addEventListener(
    "click",
    async function () {

        try {

            const stream =
                await navigator.mediaDevices
                    .getUserMedia({
                        video: true
                    });


            const video =
                document.createElement(
                    "video"
                );


            video.autoplay = true;

            video.srcObject =
                stream;


            video.style.width =
                "100%";

            video.style.maxWidth =
                "800px";

            video.style.borderRadius =
                "15px";


            const cameraWindow =
                document.createElement(
                    "div"
                );


            cameraWindow.style.position =
                "fixed";

            cameraWindow.style.inset =
                "0";

            cameraWindow.style.background =
                "#05080d";

            cameraWindow.style.display =
                "flex";

            cameraWindow.style.alignItems =
                "center";

            cameraWindow.style.justifyContent =
                "center";

            cameraWindow.style.zIndex =
                "9999";

            cameraWindow.appendChild(
                video
            );


            const close =
                document.createElement(
                    "button"
                );


            close.textContent =
                "Close Camera";


            close.style.position =
                "absolute";

            close.style.bottom =
                "40px";

            close.style.padding =
                "12px 25px";

            close.style.border =
                "none";

            close.style.borderRadius =
                "10px";

            close.style.cursor =
                "pointer";


            close.onclick =
                function () {

                    stream
                        .getTracks()
                        .forEach(
                            track =>
                                track.stop()
                        );

                    cameraWindow.remove();

                };


            cameraWindow.appendChild(
                close
            );

            document.body.appendChild(
                cameraWindow
            );

        }

        catch (error) {

            alert(
                "Camera access was denied or is unavailable."
            );

        }

    }
);