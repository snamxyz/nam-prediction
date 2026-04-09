export default function Background() {
    return (
        <div className="w-screen h-screen fixed top-0 left-0">
            <div className="bg-accent/60 w-[200px] h-[200px] blur-[250px] rounded-full"></div>
            <div className="bg-accent/70 w-[300px] h-[300px] blur-[400px] rounded-full absolute bottom-40 -right-10"></div>
            <div className="bg-teal-500/80 w-[400px] h-[200px] blur-[300px] rounded-full absolute -bottom-80 left-20"></div>

        </div>
    )
}